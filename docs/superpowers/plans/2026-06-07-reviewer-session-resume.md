# Reviewer Session Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeat reviews resume the reviewer's prior conversation (Claude, Codex, OpenCode) instead of booting a cold agent that re-reads the diff and re-derives its findings every time.

**Architecture:** Every reviewing surface funnels through one headless launcher (`native/src/sessions/reviewer.rs`). We make it **return the resolved session id** alongside the review text, and accept an optional "resume this id" input. Providers expose resume two ways, unified behind that contract:
- **Claude** mints nothing on its own — *we* mint a UUID and pass `--session-id <uuid>` to start, `--resume <uuid>` to continue (both work with `-p`; stdout stays plain text).
- **Codex** and **OpenCode** mint the id internally, so we run them in JSON-event mode (`codex exec --json`, `opencode run --format json`), **capture** the id from the event stream, and resume by it (`codex exec resume <id>`, `opencode run --session <id>`). A small decoder extracts the human-facing review text and the session id from those event streams so the rest of the system treats every provider identically.

Each caller persists the returned id where the review thread spans separate invocations (task loop across idle rounds; single PR review across reruns) and keeps it in memory where it spans rounds inside one run (consensus). The rule is **capture once, keep**: store the id from the first successful run and resume that exact id thereafter.

**Tech Stack:** Rust + Tauri, `rusqlite` (SQLite), `serde_json` + `uuid` (both already dependencies). No frontend changes — the session id is backend-internal.

**Verification reality:** Argv construction and the JSON decoders are fully unit/fixture-tested in this environment (the fixtures below are real captured output). End-to-end Codex/OpenCode resume is verified manually by the user (Codex needs auth and real model calls; OpenCode lives at `~/.opencode/bin`).

**Captured fixtures (real output, used in tests):**
- Codex `exec --json` (one event per line):
  - `{"type":"thread.started","thread_id":"019ea176-226e-70b2-a6b5-cdceddc3c91f"}`
  - `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}`
  - `{"type":"turn.completed","usage":{...}}`
  - Even for long output, the full review arrives in a **single** `item.completed` `agent_message` (no token deltas in exec mode).
- OpenCode `run --format json` (one event per line):
  - `{"type":"step_start","sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","part":{...}}`
  - `{"type":"text","sessionID":"ses_...","part":{"type":"text","text":"ok",...}}`
  - `{"type":"step_finish",...}`
  - The full review arrives in a **single** `text` event's `part.text` (no token deltas in run mode).

**Scope note:** This plan implements option A (session resume). Option C (skip-when-unchanged) remains a separate follow-up — see the end.

---

## File Structure

**Created:**
- `native/src/sessions/reviewer_output.rs` — per-provider stdout decoder: `ReviewerWire`, the `ReviewerOutputCollector`, and the pure `parse_codex_event` / `parse_opencode_event` line parsers + fixture tests.

**Modified:**
- `native/src/sessions/mod.rs` — declare `mod reviewer_output;`.
- `native/src/sessions/reviewer.rs` — `ReviewerRunOutput`, `reviewer_supports_resume`, `new_reviewer_session_id`; resume-aware `build_reviewer_args`; `run_reviewer_command` returns the resolved id and decodes via the collector.
- `native/src/sessions/review_loop.rs` — mint/persist/resume per task loop; `build_review_continuation_prompt`.
- `native/src/sessions/pr_consensus.rs` — in-memory per-reviewer session map across rounds.
- `native/src/sessions/pr_review.rs` — persist/resume across reruns; `build_pr_review_continuation_prompt`.
- `native/src/db/schema.rs` — two additive column migrations.
- `native/src/db/review_loops.rs` — get/set `reviewer_session_id`; reset on loop restart.
- `native/src/db/pr_reviews.rs` — get/set `reviewer_session_id`.
- `native/src/db/tests.rs` — persistence tests for the two new accessors.
- `docs/features.md`, `docs/tracking-and-debugging.md`, `CLAUDE.md` — document the behavior and new columns.

---

## Task 1: Per-provider reviewer output decoder

A self-contained, fully testable module. No other file depends on it yet (Task 2 wires it in).

**Files:**
- Create: `native/src/sessions/reviewer_output.rs`
- Modify: `native/src/sessions/mod.rs` (add `mod reviewer_output;` after line 30 `mod reviewer;`)

- [ ] **Step 1: Create the module with the decoder and pure parsers**

Create `native/src/sessions/reviewer_output.rs`:

```rust
//! Per-provider reviewer stdout decoding.
//!
//! Plain-text reviewer CLIs (Claude, Gemini, custom) emit the review on stdout
//! verbatim. The JSON-event CLIs report the review text AND their session id
//! inside a newline-delimited event stream (Codex `exec --json`, OpenCode
//! `run --format json`); this module extracts both so the launcher can treat
//! every provider uniformly: a human-facing review string plus an optional
//! resolved session id to persist and resume.

use crate::models::AgentKind;

/// How a reviewer's stdout is encoded.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ReviewerWire {
    /// stdout is the review text verbatim.
    Plain,
    /// Newline-delimited Codex `exec --json` events.
    CodexJson,
    /// Newline-delimited OpenCode `run --format json` events.
    OpenCodeJson,
}

impl ReviewerWire {
    pub(super) fn for_kind(kind: AgentKind) -> Self {
        match kind {
            AgentKind::Codex => ReviewerWire::CodexJson,
            AgentKind::OpenCode => ReviewerWire::OpenCodeJson,
            AgentKind::Claude | AgentKind::Gemini | AgentKind::Custom => ReviewerWire::Plain,
        }
    }
}

/// Accumulates a reviewer's stdout, yielding human-facing text deltas for live
/// streaming and, at EOF, the full review text plus any captured session id.
pub(super) struct ReviewerOutputCollector {
    wire: ReviewerWire,
    /// Claude supplies its (minted/resumed) id up front; capture providers fill
    /// this in from the stream.
    session_id: Option<String>,
    /// Buffer for an incomplete trailing line (JSON wires only).
    line_buf: String,
    /// Full human-facing review text accumulated so far.
    text: String,
}

impl ReviewerOutputCollector {
    pub(super) fn new(wire: ReviewerWire, session_id: Option<String>) -> Self {
        Self {
            wire,
            session_id,
            line_buf: String::new(),
            text: String::new(),
        }
    }

    /// Feed a raw stdout chunk; return the human-facing text delta to stream live
    /// (empty when the chunk carried only protocol/no new text).
    pub(super) fn push(&mut self, chunk: &[u8]) -> String {
        let chunk = String::from_utf8_lossy(chunk);
        if self.wire == ReviewerWire::Plain {
            self.text.push_str(&chunk);
            return chunk.into_owned();
        }
        self.line_buf.push_str(&chunk);
        let mut delta = String::new();
        while let Some(newline) = self.line_buf.find('\n') {
            let line: String = self.line_buf.drain(..=newline).collect();
            self.ingest_line(line.trim(), &mut delta);
        }
        delta
    }

    /// Finalize after EOF: flush any trailing partial line and return the full
    /// review text (trimmed) plus the resolved session id.
    pub(super) fn finish(mut self) -> (String, Option<String>) {
        if self.wire != ReviewerWire::Plain {
            let line = std::mem::take(&mut self.line_buf);
            let mut sink = String::new();
            self.ingest_line(line.trim(), &mut sink);
        }
        (self.text.trim().to_string(), self.session_id)
    }

    fn ingest_line(&mut self, line: &str, delta: &mut String) {
        if line.is_empty() {
            return;
        }
        let (fragment, session_id) = match self.wire {
            ReviewerWire::CodexJson => parse_codex_event(line),
            ReviewerWire::OpenCodeJson => parse_opencode_event(line),
            ReviewerWire::Plain => (None, None),
        };
        if let Some(session_id) = session_id {
            self.session_id = Some(session_id);
        }
        if let Some(fragment) = fragment {
            self.text.push_str(&fragment);
            delta.push_str(&fragment);
        }
    }
}

/// Parse one Codex `exec --json` event line into `(text_fragment, session_id)`.
/// The id rides the `thread.started` event; the review text rides
/// `item.completed` events whose item is an `agent_message`.
fn parse_codex_event(line: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (None, None);
    };
    match value.get("type").and_then(|t| t.as_str()) {
        Some("thread.started") => (
            None,
            value
                .get("thread_id")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        ),
        Some("item.completed") => {
            let item = value.get("item");
            let is_message =
                item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) == Some("agent_message");
            let text = is_message
                .then(|| item.and_then(|i| i.get("text")).and_then(|t| t.as_str()))
                .flatten()
                .map(str::to_string);
            (text, None)
        }
        _ => (None, None),
    }
}

/// Parse one OpenCode `run --format json` event line into
/// `(text_fragment, session_id)`. Every event carries `sessionID`; the review
/// text rides `type:"text"` events as `part.text`.
fn parse_opencode_event(line: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (None, None);
    };
    let session_id = value
        .get("sessionID")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let text = (value.get("type").and_then(|t| t.as_str()) == Some("text"))
        .then(|| {
            value
                .get("part")
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
        })
        .flatten()
        .map(str::to_string);
    (text, session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_event_parsing_extracts_thread_id_and_message_text() {
        assert_eq!(
            parse_codex_event(
                r#"{"type":"thread.started","thread_id":"019ea176-226e-70b2-a6b5-cdceddc3c91f"}"#
            ),
            (None, Some("019ea176-226e-70b2-a6b5-cdceddc3c91f".to_string()))
        );
        assert_eq!(
            parse_codex_event(
                r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}"#
            ),
            (Some("ok".to_string()), None)
        );
        // Non-message items and other events contribute nothing.
        assert_eq!(
            parse_codex_event(r#"{"type":"turn.completed","usage":{}}"#),
            (None, None)
        );
        assert_eq!(parse_codex_event("not json"), (None, None));
    }

    #[test]
    fn opencode_event_parsing_extracts_session_id_and_text() {
        let text_line = r#"{"type":"text","timestamp":1,"sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","part":{"id":"prt_x","messageID":"msg_y","sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","type":"text","text":"ok"}}"#;
        assert_eq!(
            parse_opencode_event(text_line),
            (
                Some("ok".to_string()),
                Some("ses_15e897088ffeTZK2xT5MsHRUBC".to_string())
            )
        );
        // Non-text events still surface the session id but no text.
        assert_eq!(
            parse_opencode_event(r#"{"type":"step_start","sessionID":"ses_abc","part":{"id":"p"}}"#),
            (None, Some("ses_abc".to_string()))
        );
    }

    #[test]
    fn collector_accumulates_codex_stream_across_chunk_boundaries() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::CodexJson, None);
        // Split one event across two pushes to exercise the partial-line buffer.
        collector.push(
            b"{\"type\":\"thread.started\",\"thread_id\":\"tid-1\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_m",
        );
        let delta = collector.push(b"essage\",\"text\":\"NECTUS_NO_BLOCKERS\"}}\n");
        assert_eq!(delta, "NECTUS_NO_BLOCKERS");
        assert_eq!(
            collector.finish(),
            ("NECTUS_NO_BLOCKERS".to_string(), Some("tid-1".to_string()))
        );
    }

    #[test]
    fn collector_accumulates_opencode_text_and_session() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::OpenCodeJson, None);
        collector.push(b"{\"type\":\"step_start\",\"sessionID\":\"ses_1\",\"part\":{}}\n");
        let delta = collector
            .push(b"{\"type\":\"text\",\"sessionID\":\"ses_1\",\"part\":{\"type\":\"text\",\"text\":\"PASS\"}}\n");
        assert_eq!(delta, "PASS");
        assert_eq!(collector.finish(), ("PASS".to_string(), Some("ses_1".to_string())));
    }

    #[test]
    fn collector_passes_plain_text_through_and_keeps_preset_session() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::Plain, Some("sid".to_string()));
        assert_eq!(collector.push(b"PASS\n"), "PASS\n");
        assert_eq!(collector.push(b"looks good"), "looks good");
        assert_eq!(
            collector.finish(),
            ("PASS\nlooks good".to_string(), Some("sid".to_string()))
        );
    }
}
```

- [ ] **Step 2: Register the module**

In `native/src/sessions/mod.rs`, add after line 30 (`mod reviewer;`):

```rust
mod reviewer_output;
```

- [ ] **Step 3: Run the tests**

Run: `cd native && cargo test reviewer_output`
Expected: all five tests PASS.

- [ ] **Step 4: Commit**

```bash
git add native/src/sessions/reviewer_output.rs native/src/sessions/mod.rs
git commit -m "feat(reviewer): decode codex/opencode JSON event streams to text + session id"
```

---

## Task 2: Launcher returns the resolved session id

**Files:**
- Modify: `native/src/sessions/reviewer.rs`
- Modify: `native/src/sessions/review_loop.rs:82` (adapt to `.text`)
- Modify: `native/src/sessions/pr_review.rs:68` (adapt to `.text`)
- Modify: `native/src/sessions/pr_consensus.rs:200,219` (adapt to `.text`)

- [ ] **Step 1: Add the return type, helpers, and imports**

In `native/src/sessions/reviewer.rs`, update the imports at the top to add the collector and `AgentKind` is already imported:

```rust
use super::command::resolve_agent_command;
use super::reviewer_output::{ReviewerOutputCollector, ReviewerWire};
use crate::models::{AgentKind, AgentProfile, ReviewOutputEvent};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
```

After the `ReviewOutputSink` struct, add:

```rust
/// The result of one reviewer run: the human-facing review text and the resolved
/// session id to persist and resume (None for providers without resume support,
/// or when capture failed).
pub(super) struct ReviewerRunOutput {
    pub text: String,
    pub session_id: Option<String>,
}

/// Whether a reviewer kind can resume a prior conversation. Claude mints its own
/// id (`--session-id`/`--resume`); Codex and OpenCode mint internally and we
/// capture + resume by id. Gemini/Custom have no supported resume path.
pub(super) fn reviewer_supports_resume(kind: AgentKind) -> bool {
    matches!(kind, AgentKind::Claude | AgentKind::Codex | AgentKind::OpenCode)
}

/// Mint a fresh reviewer session id for Claude's `--session-id` (requires a
/// UUID), matching the v4 UUIDs used for live PTY sessions.
pub(super) fn new_reviewer_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
```

- [ ] **Step 2: Make `run_reviewer_command` resume-aware and id-returning**

Replace the whole `run_reviewer_command` function with:

```rust
pub(super) fn run_reviewer_command(
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
    resume: Option<&str>,
    stream: Option<&ReviewOutputSink>,
) -> Result<ReviewerRunOutput, String> {
    let executable = resolve_agent_command(&reviewer.command)?;

    // Claude mints its own id up front; capture providers learn theirs from the
    // run. Resolve the wire and any preset id before building argv.
    let wire = ReviewerWire::for_kind(reviewer.agent_kind);
    let claude_start_id = (reviewer.agent_kind == AgentKind::Claude && resume.is_none())
        .then(new_reviewer_session_id);
    let preset_session_id = match reviewer.agent_kind {
        AgentKind::Claude => resume.map(str::to_string).or_else(|| claude_start_id.clone()),
        _ => None,
    };

    let plan = build_reviewer_args(reviewer, prompt, resume, claude_start_id.as_deref());
    let mut command = Command::new(executable);
    command.args(&plan.args);
    // A GUI-launched app has a minimal PATH, so a node-based reviewer CLI (e.g.
    // Codex, OpenCode) fails to exec `node`. Hand the child a PATH that includes
    // the common install dirs; a profile's own PATH still wins since its env is
    // applied next.
    command.env("PATH", crate::process_util::augmented_path());
    for (key, value) in &reviewer.env {
        command.env(key, value);
    }
    command
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start reviewer {}: {error}", reviewer.name))?;
    {
        // Take and drop stdin so the child sees EOF: write the prompt first for
        // reviewers that read it from stdin, otherwise just close the pipe.
        let mut stdin = child.stdin.take();
        if plan.pipe_prompt_to_stdin {
            if let Some(stdin) = stdin.as_mut() {
                stdin
                    .write_all(prompt.as_bytes())
                    .map_err(|error| format!("Failed to send review prompt: {error}"))?;
            }
        }
    }

    // Drain stderr on its own thread so a chatty reviewer can't deadlock by
    // filling the stderr pipe while we block reading stdout.
    let stderr_handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = stderr.read_to_end(&mut buffer);
            buffer
        })
    });

    // Decode stdout incrementally through the per-provider collector: emit each
    // human-facing text delta for the live view while accumulating the review
    // text and capturing the session id. On a read error we stop the loop but
    // still fall through to the single kill/wait + stderr join below.
    let mut collector = ReviewerOutputCollector::new(wire, preset_session_id);
    let mut streamed_len: u64 = 0;
    let mut read_error = None;
    if let Some(mut stdout) = child.stdout.take() {
        let mut buffer = [0_u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let delta = collector.push(&buffer[..count]);
                    if !delta.is_empty() {
                        if let Some(sink) = stream {
                            let _ = sink.app.emit(
                                "review_output",
                                ReviewOutputEvent {
                                    task_id: sink.task_id,
                                    data: delta.clone(),
                                    start_offset: streamed_len,
                                },
                            );
                        }
                        streamed_len += delta.len() as u64;
                    }
                }
                Err(error) => {
                    read_error = Some(format!("Failed to read reviewer output: {error}"));
                    break;
                }
            }
        }
    }

    // A read error leaves the child possibly still running; kill it so the wait
    // below can't block forever.
    if read_error.is_some() {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|error| format!("Failed to read reviewer output: {error}"))?;
    let stderr = stderr_handle
        .and_then(|handle| handle.join().ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_string())
        .unwrap_or_default();
    if let Some(error) = read_error {
        return Err(error);
    }
    let (text, session_id) = collector.finish();
    if !status.success() {
        return Err(if stderr.is_empty() {
            format!("Reviewer exited with {status}")
        } else {
            format!("Reviewer exited with {status}: {stderr}")
        });
    }
    Ok(ReviewerRunOutput { text, session_id })
}
```

- [ ] **Step 3: Make `build_reviewer_args` resume-aware**

Replace `build_reviewer_args` (keep `ReviewerCommandPlan` and the doc comment, update the body) with:

```rust
/// Build the headless invocation for a reviewer. Each agent kind has a distinct
/// non-interactive entry point and resume form:
/// - Claude/Gemini: `-p <prompt>` print mode. Claude adds `--session-id <uuid>`
///   to start a named session or `--resume <uuid>` to continue one.
/// - Codex: `exec --json <prompt>`; resume is `exec resume <id> --json <prompt>`.
///   `--json` is required so the session id (and review text) can be captured.
/// - OpenCode: `run --format json <prompt>`; resume adds `--session <id>`.
/// - Custom: the prompt is piped to stdin, since the command is arbitrary.
fn build_reviewer_args(
    reviewer: &AgentProfile,
    prompt: &str,
    resume: Option<&str>,
    claude_start_id: Option<&str>,
) -> ReviewerCommandPlan {
    let mut args = Vec::new();
    match reviewer.agent_kind {
        AgentKind::Codex => {
            args.push("exec".to_string());
            if let Some(id) = resume {
                args.push("resume".to_string());
                args.push(id.to_string());
            }
            args.push("--json".to_string());
        }
        AgentKind::OpenCode => {
            args.push("run".to_string());
            if let Some(id) = resume {
                args.push("--session".to_string());
                args.push(id.to_string());
            }
            args.push("--format".to_string());
            args.push("json".to_string());
        }
        AgentKind::Claude | AgentKind::Gemini | AgentKind::Custom => {}
    }
    if let Some(model) = reviewer
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.extend(reviewer.args.iter().cloned());

    // Claude session continuity (mint-our-own-id). Codex/OpenCode resume was
    // handled in the subcommand block above; Gemini/Custom have no resume.
    if reviewer.agent_kind == AgentKind::Claude {
        if let Some(id) = resume {
            args.push("--resume".to_string());
            args.push(id.to_string());
        } else if let Some(id) = claude_start_id {
            args.push("--session-id".to_string());
            args.push(id.to_string());
        }
    }

    let pipe_prompt_to_stdin = match reviewer.agent_kind {
        AgentKind::Claude | AgentKind::Gemini => {
            args.push("-p".to_string());
            args.push(prompt.to_string());
            false
        }
        AgentKind::Codex | AgentKind::OpenCode => {
            args.push(prompt.to_string());
            false
        }
        AgentKind::Custom => true,
    };
    ReviewerCommandPlan {
        args,
        pipe_prompt_to_stdin,
    }
}
```

- [ ] **Step 4: Update the four call sites to use `.text`**

These keep current behavior (no resume yet — that's wired per surface in later tasks). Add the new `resume` arg as `None` and read `.text`:

- `native/src/sessions/review_loop.rs:82` — change the matched call:
```rust
    let reviewer_output = match run_reviewer_command(&reviewer, cwd, &prompt, None, Some(&sink)) {
        Ok(output) => output.text,
        Err(error) => {
```
- `native/src/sessions/pr_review.rs:68`:
```rust
            run_reviewer_command(&reviewer, worktree_path, &prompt, None, None).map(|output| output.text)
```
- `native/src/sessions/pr_consensus.rs:200` (synthesizer):
```rust
    let synth_raw = run_reviewer_command(synthesizer, worktree_path, &synth_prompt, None, None)?.text;
```
- `native/src/sessions/pr_consensus.rs:219` (inside `run_round_parallel`):
```rust
                scope.spawn(move || {
                    run_reviewer_command(reviewer, worktree_path, prompt, None, None).map(|output| output.text)
                })
```

- [ ] **Step 5: Update existing `build_reviewer_args` tests + add resume tests**

In `reviewer.rs` tests, the four-arg signature changes every call. Update the existing expectations to include the new JSON flags, and add resume coverage. Replace the existing test bodies with:

```rust
    #[test]
    fn codex_reviewer_runs_headless_exec_json_with_prompt_as_positional_arg() {
        let plan = build_reviewer_args(
            &agent("Codex", AgentKind::Codex, "codex"),
            "Review this",
            None,
            None,
        );
        assert_eq!(
            plan.args,
            vec!["exec".to_string(), "--json".to_string(), "Review this".to_string()]
        );
        assert!(!plan.pipe_prompt_to_stdin);
    }

    #[test]
    fn codex_reviewer_exec_precedes_model_and_profile_args() {
        let mut profile = agent("Codex", AgentKind::Codex, "codex");
        profile.model = Some("gpt-5.3-codex".to_string());
        profile.args = vec!["--full-auto".to_string()];

        let plan = build_reviewer_args(&profile, "Review this", None, None);

        assert_eq!(
            plan.args,
            vec![
                "exec".to_string(),
                "--json".to_string(),
                "--model".to_string(),
                "gpt-5.3-codex".to_string(),
                "--full-auto".to_string(),
                "Review this".to_string(),
            ]
        );
    }

    #[test]
    fn codex_reviewer_resume_uses_resume_subcommand_with_session_id() {
        let plan = build_reviewer_args(
            &agent("Codex", AgentKind::Codex, "codex"),
            "Re-check",
            Some("tid-1"),
            None,
        );
        assert_eq!(
            plan.args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "tid-1".to_string(),
                "--json".to_string(),
                "Re-check".to_string(),
            ]
        );
    }

    #[test]
    fn sends_claude_and_gemini_review_prompts_through_headless_print_mode() {
        let claude = build_reviewer_args(
            &agent("Claude", AgentKind::Claude, "claude"),
            "Review this",
            None,
            None,
        );
        assert_eq!(claude.args, vec!["-p".to_string(), "Review this".to_string()]);

        let gemini = build_reviewer_args(
            &agent("Gemini", AgentKind::Gemini, "gemini"),
            "Review this",
            None,
            None,
        );
        assert_eq!(gemini.args, vec!["-p".to_string(), "Review this".to_string()]);
    }

    #[test]
    fn claude_reviewer_starts_a_named_session_then_resumes_it() {
        let claude = agent("Claude", AgentKind::Claude, "claude");
        let start = build_reviewer_args(&claude, "Review this", None, Some("sid-1"));
        assert_eq!(
            start.args,
            vec![
                "--session-id".to_string(),
                "sid-1".to_string(),
                "-p".to_string(),
                "Review this".to_string(),
            ]
        );

        let resume = build_reviewer_args(&claude, "Re-check", Some("sid-1"), None);
        assert_eq!(
            resume.args,
            vec![
                "--resume".to_string(),
                "sid-1".to_string(),
                "-p".to_string(),
                "Re-check".to_string(),
            ]
        );
    }

    #[test]
    fn opencode_reviewer_uses_run_format_json_and_session_resume() {
        let mut profile = agent("OpenCode", AgentKind::OpenCode, "opencode");
        profile.model = Some("anthropic/claude-sonnet-4-5-20250929".to_string());
        profile.args = vec!["--agent".to_string(), "build".to_string()];

        let start = build_reviewer_args(&profile, "Review this", None, None);
        assert_eq!(
            start.args,
            vec![
                "run".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--model".to_string(),
                "anthropic/claude-sonnet-4-5-20250929".to_string(),
                "--agent".to_string(),
                "build".to_string(),
                "Review this".to_string(),
            ]
        );

        let resume = build_reviewer_args(&profile, "Re-check", Some("ses_1"), None);
        assert_eq!(
            resume.args,
            vec![
                "run".to_string(),
                "--session".to_string(),
                "ses_1".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--model".to_string(),
                "anthropic/claude-sonnet-4-5-20250929".to_string(),
                "--agent".to_string(),
                "build".to_string(),
                "Re-check".to_string(),
            ]
        );
    }

    #[test]
    fn custom_reviewer_pipes_prompt_to_stdin() {
        let plan = build_reviewer_args(
            &agent("Custom", AgentKind::Custom, "reviewer"),
            "Review this",
            None,
            None,
        );
        assert!(plan.args.is_empty());
        assert!(plan.pipe_prompt_to_stdin);
    }

    #[test]
    fn only_claude_codex_opencode_support_session_resume() {
        assert!(reviewer_supports_resume(AgentKind::Claude));
        assert!(reviewer_supports_resume(AgentKind::Codex));
        assert!(reviewer_supports_resume(AgentKind::OpenCode));
        assert!(!reviewer_supports_resume(AgentKind::Gemini));
        assert!(!reviewer_supports_resume(AgentKind::Custom));
    }

    #[test]
    fn new_reviewer_session_id_is_a_unique_uuid() {
        let a = new_reviewer_session_id();
        let b = new_reviewer_session_id();
        assert_eq!(a.len(), 36);
        assert_ne!(a, b);
    }
```

(Delete the now-replaced original tests `codex_reviewer_runs_headless_exec_with_prompt_as_positional_arg` and `opencode_reviewer_uses_run_subcommand_with_prompt_as_positional_arg`; their replacements above cover the same ground with the new flags.)

- [ ] **Step 6: Build and test**

Run: `cd native && cargo build && cargo test reviewer`
Expected: builds clean; all reviewer tests PASS.

- [ ] **Step 7: Commit**

```bash
git add native/src/sessions/reviewer.rs native/src/sessions/review_loop.rs native/src/sessions/pr_review.rs native/src/sessions/pr_consensus.rs
git commit -m "feat(reviewer): launcher returns resolved session id and accepts a resume id"
```

---

## Task 3: Persist a reviewer session id on the task review loop

**Files:**
- Modify: `native/src/db/schema.rs`
- Modify: `native/src/db/review_loops.rs`
- Test: `native/src/db/tests.rs`

- [ ] **Step 1: Add the column migration**

In `native/src/db/schema.rs`, inside `run_migrations` (before the `tasks.workspace_id` block), add:

```rust
        // Reviewer session resume: the resolved session id reused across a loop's
        // idle rounds so repeat reviews continue the same conversation instead of
        // booting cold. Reset when the loop is (re)started.
        self.add_column_if_missing("review_loops", "reviewer_session_id", "TEXT")?;
```

- [ ] **Step 2: Reset the session id when a loop is (re)started**

In `native/src/db/review_loops.rs`, in `start_review_loop`'s `ON CONFLICT(task_id) DO UPDATE SET` clause, add the reset:

```rust
                ON CONFLICT(task_id) DO UPDATE SET
                  reviewer_profile_id = excluded.reviewer_profile_id,
                  status = excluded.status,
                  last_error = NULL,
                  reviewer_session_id = NULL,
                  updated_at = excluded.updated_at
```

- [ ] **Step 3: Add get/set accessors**

In `native/src/db/review_loops.rs`, inside `impl Database`, add:

```rust
    /// The reviewer session id reused across this loop's review rounds, if one
    /// has been resolved yet.
    pub fn review_loop_session_id(&self, task_id: i64) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT reviewer_session_id FROM review_loops WHERE task_id = ?1",
                params![task_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
            .map_err(|error| error.to_string())
    }

    /// Store (or clear) the reviewer session id so the next round can resume it.
    pub fn set_review_loop_session_id(
        &self,
        task_id: i64,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        let changed = self
            .conn
            .execute(
                "UPDATE review_loops SET reviewer_session_id = ?1, updated_at = ?2 WHERE task_id = ?3",
                params![session_id, now(), task_id],
            )
            .map_err(|error| format!("Failed to update review loop session: {error}"))?;
        if changed == 0 {
            return Err("Review loop not found".to_string());
        }
        Ok(())
    }
```

- [ ] **Step 4: Write the persistence test**

In `native/src/db/tests.rs`, add:

```rust
#[test]
fn review_loop_tracks_and_resets_reviewer_session_id() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Task".to_string(),
            None,
            Some(profiles[0].id),
            false,
            None,
        )
        .unwrap();

    db.start_review_loop(task.id, reviewer.id).unwrap();
    assert_eq!(db.review_loop_session_id(task.id).unwrap(), None);

    db.set_review_loop_session_id(task.id, Some("sid-1")).unwrap();
    assert_eq!(
        db.review_loop_session_id(task.id).unwrap(),
        Some("sid-1".to_string())
    );

    // Restarting the loop begins a fresh review thread, so the id resets.
    db.start_review_loop(task.id, reviewer.id).unwrap();
    assert_eq!(db.review_loop_session_id(task.id).unwrap(), None);
}
```

- [ ] **Step 5: Run the test**

Run: `cd native && cargo test review_loop_tracks_and_resets_reviewer_session_id`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/src/db/schema.rs native/src/db/review_loops.rs native/src/db/tests.rs
git commit -m "feat(db): persist a resumable reviewer session id on review loops"
```

---

## Task 4: Resume the reviewer across task-loop rounds

**Files:**
- Modify: `native/src/sessions/review_loop.rs`

- [ ] **Step 1: Write the failing continuation-prompt test**

In `review_loop.rs` tests, add:

```rust
    #[test]
    fn builds_review_continuation_prompt_for_a_resumed_reviewer() {
        let prompt = build_review_continuation_prompt(&task());

        assert!(prompt.contains("Implement settings panel"));
        assert!(prompt.to_lowercase().contains("already reviewed"));
        assert!(prompt.contains("git diff --no-ext-diff HEAD --"));
        assert!(prompt.contains("NECTUS_NO_BLOCKERS"));
        assert!(prompt.contains("NECTUS_BLOCKERS"));
        assert!(prompt.contains("NECTUS_FEEDBACK"));
        assert!(!prompt.contains("diff --git"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd native && cargo test builds_review_continuation_prompt_for_a_resumed_reviewer`
Expected: FAIL — not defined.

- [ ] **Step 3: Add the continuation prompt**

In `review_loop.rs`, after `build_review_prompt`, add:

```rust
pub(super) fn build_review_continuation_prompt(task: &TaskSummary) -> String {
    format!(
        "\
You have already reviewed this task earlier in this same conversation, and the author has responded to your feedback.

Task title:
{title}

Re-inspect only what changed since your last review:
- git status --short
- git diff --no-ext-diff HEAD --

You already remember your prior findings — do not re-derive the whole review. Confirm whether your earlier blockers were addressed and whether the latest changes introduced new ones.
Return one exact verdict token on the first line:
- NECTUS_BLOCKERS when blockers remain or new ones appeared.
- NECTUS_FEEDBACK when there are no blockers, but there is meaningful implementation or approach feedback worth considering.
- NECTUS_NO_BLOCKERS when there are no blockers and no material feedback.

After NECTUS_BLOCKERS, list only the concise outstanding blockers with file paths when possible.
After NECTUS_FEEDBACK, list concise non-blocking implementation or approach suggestions.
",
        title = task.title,
    )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd native && cargo test builds_review_continuation_prompt_for_a_resumed_reviewer`
Expected: PASS.

- [ ] **Step 5: Update imports**

In `review_loop.rs`, change line 6 to:

```rust
use super::reviewer::{
    new_reviewer_session_id, reviewer_supports_resume, run_reviewer_command, ReviewOutputSink,
};
```

(`new_reviewer_session_id` is imported for symmetry but the launcher mints Claude ids internally; it is harmless if unused — if `cargo build` warns "unused import", drop it from this `use`.)

- [ ] **Step 6: Wire mint/resume into `run_review_round`**

Replace the block from `let prompt = build_review_prompt(&task);` through the `match run_reviewer_command(...) { ... }` (the one assigning `reviewer_output`) with:

```rust
    // Reuse a resolved reviewer session so repeat rounds resume the same
    // conversation instead of booting cold and re-deriving the whole review.
    // Only resume-capable reviewers (Claude/Codex/OpenCode) carry a session.
    let supports_resume = reviewer_supports_resume(reviewer.agent_kind);
    let resume_id = if supports_resume {
        db.lock().review_loop_session_id(task_id)?
    } else {
        None
    };
    let resuming = resume_id.is_some();
    let prompt = if resuming {
        build_review_continuation_prompt(&task)
    } else {
        build_review_prompt(&task)
    };
    tracing::info!(task_id, reviewer = %reviewer.name, resuming, "starting review");
    // Stream the reviewer's stdout to the workspace so the user can watch the
    // review progress live (read-only); the full output is still captured below.
    let sink = ReviewOutputSink {
        app: app.clone(),
        task_id,
    };
    let run_output = match run_reviewer_command(&reviewer, cwd, &prompt, resume_id.as_deref(), Some(&sink))
    {
        Ok(output) => output,
        Err(error) => {
            let run = db.lock().record_review_run(ReviewRunInput {
                task_id,
                reviewer_profile_id: reviewer.id,
                verdict: ReviewVerdict::Unknown,
                prompt,
                output: String::new(),
                error: Some(error.clone()),
            })?;
            emit_review_loop_update(&app, &db, task_id, Some(run));
            return Err(error);
        }
    };

    // Capture once, keep: persist the resolved id only when we did not already
    // have one, so the canonical thread (esp. for Codex/OpenCode) is the one we
    // keep resuming.
    if supports_resume && !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock().set_review_loop_session_id(task_id, Some(session_id))?;
        }
    }
    let reviewer_output = run_output.text;
```

(`let _ = new_reviewer_session_id;` is NOT needed — remove the import if unused per Step 5.)

- [ ] **Step 7: Build and test**

Run: `cd native && cargo build && cargo test review_loop`
Expected: builds clean; all `review_loop` tests PASS.

- [ ] **Step 8: Commit**

```bash
git add native/src/sessions/review_loop.rs
git commit -m "feat(review-loop): resume the reviewer across idle rounds"
```

---

## Task 5: Resume each reviewer across consensus rounds

In-memory per-reviewer map, scoped to the run (capture once, keep). Exercised by the existing consensus tests (prompt/convergence behavior unchanged) plus a compile check; the session wiring spawns real reviewer CLIs and is verified manually.

**Files:**
- Modify: `native/src/sessions/pr_consensus.rs`

- [ ] **Step 1: Update imports**

Change line 4 from:
```rust
use super::reviewer::run_reviewer_command;
```
to:
```rust
use super::reviewer::{reviewer_supports_resume, run_reviewer_command, ReviewerRunOutput};
use std::collections::HashMap;
```

- [ ] **Step 2: Track and pass per-reviewer session ids across rounds**

In `run_rounds_and_synthesize`, declare the map before the `for round` loop:

```rust
    let mut last_round: Vec<ReviewerOutcome> = Vec::new();
    let mut converged = false;
    let mut agreed_verdict = PrReviewVerdict::Inconclusive;
    // reviewer_profile_id -> resolved session id (capture once, keep).
    let mut sessions: HashMap<i64, String> = HashMap::new();
```

Replace the `plans` construction so each plan carries its resume id, and update the parallel call:

```rust
        let plans: Vec<(&AgentProfile, String, Option<String>)> = reviewers
            .iter()
            .map(|reviewer| {
                let prompt = if round == 1 {
                    build_pr_review_prompt(pr_number, meta)
                } else {
                    build_debate_prompt(pr_number, meta, round, reviewer.id, &last_round)
                };
                let resume_id = if reviewer_supports_resume(reviewer.agent_kind) {
                    sessions.get(&reviewer.id).cloned()
                } else {
                    None
                };
                (reviewer, prompt, resume_id)
            })
            .collect();

        let outputs = run_round_parallel(&plans, worktree_path);
```

- [ ] **Step 3: Record outcomes from `ReviewerRunOutput` and capture ids**

Replace the round-outcomes loop header and result handling:

```rust
        let mut round_outcomes = Vec::with_capacity(plans.len());
        for ((reviewer, _prompt, _resume), output) in plans.iter().zip(outputs) {
            let (verdict, review, error) = match output {
                Ok(run) => {
                    // Capture once, keep: store the resolved id the first time.
                    if let Some(session_id) = run.session_id {
                        sessions.entry(reviewer.id).or_insert(session_id);
                    }
                    let (verdict, review) = parse_pr_review_output(&run.text);
                    (verdict, review, None)
                }
                Err(error) => (PrReviewVerdict::Inconclusive, String::new(), Some(error)),
            };
            let run = db.lock().record_pr_review_run(PrReviewRunInput {
                pr_review_id: review_id,
                reviewer_profile_id: reviewer.id,
                round,
                verdict,
                output: review.clone(),
                error: error.clone(),
            })?;
            emit_consensus_update(app, db, review_id, Some(run));
            round_outcomes.push(ReviewerOutcome {
                reviewer_profile_id: reviewer.id,
                name: reviewer.name.clone(),
                verdict,
                review,
                error,
            });
        }
```

- [ ] **Step 4: Update `run_round_parallel` signature + body**

```rust
/// Run every reviewer for one round concurrently on scoped threads, preserving
/// input order. `run_reviewer_command` blocks on a child process, so a thread
/// per reviewer is the right fit; a panicked thread becomes an error result.
fn run_round_parallel(
    plans: &[(&AgentProfile, String, Option<String>)],
    worktree_path: &Path,
) -> Vec<Result<ReviewerRunOutput, String>> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = plans
            .iter()
            .map(|(reviewer, prompt, resume)| {
                scope.spawn(move || {
                    run_reviewer_command(reviewer, worktree_path, prompt, resume.as_deref(), None)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("Reviewer thread panicked".to_string()))
            })
            .collect()
    })
}
```

(The synthesizer call near the end already reads `?.text` from Task 2 — leave it; the synthesizer runs once and gains nothing from resume.)

- [ ] **Step 5: Build and test**

Run: `cd native && cargo build && cargo test pr_consensus`
Expected: builds clean; all existing `pr_consensus` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add native/src/sessions/pr_consensus.rs
git commit -m "feat(consensus): resume each reviewer across debate rounds"
```

---

## Task 6: Persist a reviewer session id on PR reviews

**Files:**
- Modify: `native/src/db/schema.rs`
- Modify: `native/src/db/pr_reviews.rs`
- Test: `native/src/db/tests.rs`

- [ ] **Step 1: Add the column migration**

In `native/src/db/schema.rs`, inside `run_migrations`, next to the consensus `pr_reviews` columns, add:

```rust
        // Reviewer session resume for a single PR review, reused on rerun so the
        // reviewer continues its prior review of the (now updated) PR instead of
        // starting over. Preserved across reruns.
        self.add_column_if_missing("pr_reviews", "reviewer_session_id", "TEXT")?;
```

- [ ] **Step 2: Add get/set accessors**

In `native/src/db/pr_reviews.rs`, inside `impl Database`, add:

```rust
    /// The reviewer session id for a single PR review, reused across reruns.
    pub fn pr_review_session_id(&self, id: i64) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT reviewer_session_id FROM pr_reviews WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
            .map_err(|error| error.to_string())
    }

    /// Store (or clear) the reviewer session id so a rerun can resume it.
    pub fn set_pr_review_session_id(
        &self,
        id: i64,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET reviewer_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![session_id, now(), id],
        )
    }
```

(Leave `reset_pr_review_for_rerun` unchanged — a rerun deliberately keeps the session id so the reviewer resumes its prior review of the updated PR.)

- [ ] **Step 3: Write the persistence test**

In `native/src/db/tests.rs`, add:

```rust
#[test]
fn pr_review_tracks_reviewer_session_id_across_reruns() {
    let db = Database::open_in_memory().unwrap();
    let (_guard, repo) = add_repo_with_remote(&db);
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let review = db
        .create_pr_review(repo.id, reviewer.id, "https://github.com/x/y/pull/1", 1)
        .unwrap();

    assert_eq!(db.pr_review_session_id(review.id).unwrap(), None);

    db.set_pr_review_session_id(review.id, Some("sid-9")).unwrap();
    assert_eq!(
        db.pr_review_session_id(review.id).unwrap(),
        Some("sid-9".to_string())
    );

    // A rerun preserves the session id so the reviewer resumes its prior review.
    db.reset_pr_review_for_rerun(review.id).unwrap();
    assert_eq!(
        db.pr_review_session_id(review.id).unwrap(),
        Some("sid-9".to_string())
    );
}
```

- [ ] **Step 4: Run the test**

Run: `cd native && cargo test pr_review_tracks_reviewer_session_id_across_reruns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add native/src/db/schema.rs native/src/db/pr_reviews.rs native/src/db/tests.rs
git commit -m "feat(db): persist a resumable reviewer session id on PR reviews"
```

---

## Task 7: Resume a single PR review on rerun

**Files:**
- Modify: `native/src/sessions/pr_review.rs`

- [ ] **Step 1: Write the failing continuation-prompt test**

In `pr_review.rs` tests, add:

```rust
    #[test]
    fn pr_review_continuation_prompt_asks_for_a_delta_update_and_verdict() {
        let meta = PrMeta {
            title: "Add request caching".to_string(),
            author: Some("octocat".to_string()),
            base_branch: Some("main".to_string()),
        };

        let prompt = build_pr_review_continuation_prompt(42, &meta);

        assert!(prompt.contains("#42"));
        assert!(prompt.contains("Add request caching"));
        assert!(prompt.to_lowercase().contains("already reviewed"));
        assert!(prompt.contains("origin/main...HEAD"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: CLEAN"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd native && cargo test pr_review_continuation_prompt_asks_for_a_delta_update_and_verdict`
Expected: FAIL — not defined.

- [ ] **Step 3: Add the continuation prompt**

In `pr_review.rs`, after `build_pr_review_prompt`, add:

```rust
pub(super) fn build_pr_review_continuation_prompt(pr_number: i64, meta: &PrMeta) -> String {
    let base = meta.base_branch.as_deref().unwrap_or("the base branch");
    format!(
        "\
You already reviewed GitHub pull request #{pr_number} earlier in this same conversation. It has since been updated, and you are reviewing it again for a human who will paste your review back to the author.

PR title: {title}
Base branch: {base}

You are in a fresh checkout of the current PR head. Re-inspect only what changed since your last review:
- git log --oneline origin/{base}..HEAD
- git diff origin/{base}...HEAD

You already remember your previous review — do not re-derive it from scratch. Update it: confirm which earlier findings are now resolved, keep the ones that still apply, and add any new issues the latest changes introduced.

Write the updated review in GitHub-flavored Markdown that the reviewer can paste directly into the pull request (summary, blocking issues with file paths, non-blocking suggestions, what's done well). Output only the Markdown review, with no preamble before it.

On the final line by itself, output the verdict: exactly `{marker} BLOCKERS` if the updated review contains any blocking issue, or `{marker} CLEAN` if it does not. This line is stripped from the review before it is shown.",
        pr_number = pr_number,
        title = meta.title,
        base = base,
        marker = PR_VERDICT_MARKER,
    )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd native && cargo test pr_review_continuation_prompt_asks_for_a_delta_update_and_verdict`
Expected: PASS.

- [ ] **Step 5: Update imports**

In `pr_review.rs`, change line 3 to:

```rust
use super::reviewer::{reviewer_supports_resume, run_reviewer_command};
```

- [ ] **Step 6: Wire mint/resume into `run_pr_review`**

Replace the `let raw_output = with_pr_worktree(...)?;` block (and adapt the result variable) with:

```rust
    // Resume a prior review session on rerun so the reviewer continues its
    // earlier review of the (now updated) PR instead of starting cold. Only
    // resume-capable reviewers (Claude/Codex/OpenCode) carry a session.
    let supports_resume = reviewer_supports_resume(reviewer.agent_kind);
    let resume_id = if supports_resume {
        db.lock().pr_review_session_id(review_id)?
    } else {
        None
    };
    let resuming = resume_id.is_some();

    // The shared scaffold owns the ephemeral worktree lifecycle (unique naming,
    // pre-clean, fetch+create, persist path, guaranteed teardown incl. branch).
    let run_output = with_pr_worktree(
        db,
        review_id,
        &repo_path,
        &default_worktree_root,
        pr_number,
        |worktree_path| {
            let prompt = if resuming {
                build_pr_review_continuation_prompt(pr_number, &meta)
            } else {
                build_pr_review_prompt(pr_number, &meta)
            };
            // PR reviews surface their output through the Reviews view, not the
            // live task workspace, so they keep the captured-output path.
            run_reviewer_command(&reviewer, worktree_path, &prompt, resume_id.as_deref(), None)
        },
    )?;

    // Capture once, keep: persist the resolved id only on the first run.
    if supports_resume && !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock().set_pr_review_session_id(review_id, Some(session_id))?;
        }
    }

    let (verdict, review_output) = parse_pr_review_output(&run_output.text);
```

(The following lines `db.lock().set_pr_review_result(...)` etc. are unchanged.)

- [ ] **Step 7: Build and test**

Run: `cd native && cargo build && cargo test pr_review`
Expected: builds clean; all `pr_review` tests PASS.

- [ ] **Step 8: Commit**

```bash
git add native/src/sessions/pr_review.rs
git commit -m "feat(pr-review): resume a single PR review on rerun"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/features.md`
- Modify: `docs/tracking-and-debugging.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `docs/features.md`** — note that Claude, Codex, and OpenCode reviewers now resume their prior conversation across task-loop idle rounds, consensus debate rounds, and PR-review reruns, so repeat reviews build on earlier findings instead of re-reading cold. Gemini/Custom review fresh each time. Mention Codex/OpenCode run in JSON-event mode for this, so their live "Watch reviewer" output appears in one chunk rather than streaming token-by-token.

- [ ] **Step 2: `docs/tracking-and-debugging.md`** — document the two new columns (`review_loops.reviewer_session_id`, reset on loop restart; `pr_reviews.reviewer_session_id`, preserved across reruns), that consensus keeps per-reviewer ids in memory for one run, and the per-provider resume mechanics (Claude `--session-id`/`--resume`; Codex `exec --json` + `exec resume <id>`; OpenCode `run --format json` + `--session <id>`), with the "capture once, keep" rule.

- [ ] **Step 3: `CLAUDE.md`** — update the `native/src/sessions/` bullet to mention `reviewer_output.rs` (the per-provider stdout decoder) and that `reviewer.rs` now owns the session-resume contract (`ReviewerRunOutput`, `reviewer_supports_resume`, `new_reviewer_session_id`) shared by all three reviewing surfaces.

- [ ] **Step 4: Commit**

```bash
git add docs/features.md docs/tracking-and-debugging.md CLAUDE.md
git commit -m "docs: describe reviewer session resume across claude/codex/opencode"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cd native && cargo test`
Expected: all tests PASS.

> Do NOT run `cargo fmt` — it rewrites committed vendored Codex files beyond your changes. Match surrounding style by hand.

- [ ] **Step 2: Frontend gate (no frontend changes expected)**

Run: `pnpm test && pnpm build`
Expected: both PASS (`src/types.ts` is untouched; session id is backend-internal).

- [ ] **Step 3: Manual smoke (user-run; needs live agents)**

In `pnpm desktop:dev`:
- **Claude** task loop: review, let the worker respond + go idle → second review resumes (faster, references earlier findings). Confirm `review_loops.reviewer_session_id` is set after round 1.
- **Codex** task loop: same — confirm a `thread_id` is captured and round 2 uses `codex exec resume`.
- **OpenCode** task loop: same — confirm a `ses_…` id is captured and round 2 uses `--session`.
- **Consensus** with ≥2 reviewers, `max_rounds ≥ 2`: later rounds resume each reviewer.
- **Single PR review** rerun: resumes rather than re-reading the whole PR.

Note: OpenCode resolves at runtime via `process_util::augmented_path()` (which includes `~/.opencode/bin`), so the app finds it even though a bare shell does not.

---

## Self-Review Notes

- **Spec coverage:** decoder (Task 1); launcher contract (Task 2); task loop (Tasks 3–4); consensus (Task 5); single PR rerun (Tasks 6–7); docs (Task 8); verification (Task 9). All three providers covered via the unified return-the-id contract.
- **Type consistency:** `ReviewerRunOutput { text, session_id }`, `reviewer_supports_resume(AgentKind) -> bool`, `new_reviewer_session_id() -> String`, and `run_reviewer_command(reviewer, cwd, prompt, resume: Option<&str>, stream) -> Result<ReviewerRunOutput, String>` are defined in Tasks 1–2 and used unchanged in Tasks 4/5/7. `build_reviewer_args(reviewer, prompt, resume, claude_start_id)` is fixed in Task 2 and only called within `reviewer.rs`.
- **Capture-once-keep:** every surface persists the resolved id only on the first run (`!resuming` / `entry().or_insert`), so the canonical Codex/OpenCode thread is the one resumed thereafter; resuming a Claude session re-passes the same id we minted.
- **Provider correctness:** the continuation prompt is only used when `reviewer_supports_resume` is true and an id exists, so cold providers never get a "you already reviewed this" prompt without the memory.

---

## Follow-up (separate plan): skip-when-unchanged (option C)

Record the commit SHA each surface last reviewed and short-circuit a repeat review when HEAD has not moved (reuse the stored verdict/output) instead of running the reviewer at all. Independent of resume; its own spec + plan.
