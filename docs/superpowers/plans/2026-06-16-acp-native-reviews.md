# ACP-Native Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke headless-CLI reviewer with a headless ACP session driver, so chat and reviews share one agent-driving mechanism (ACP).

**Architecture:** A new `review_runtime.rs` drives a one-shot headless ACP turn (initialize → session/new-or-load → prompt → stream chunks → stop reason), auto-approving all permission requests and capturing the agent's final message. The machine verdict moves from a `NECTUS_VERDICT:` prose marker to a validated trailing ` ```json {"verdict": ...} ` block with one-shot session self-repair. The chat runtime (`acp_manager.rs::run_connection`) is not modified; the reviewer reuses low-level ACP helpers. Custom reviewers are dropped.

**Tech Stack:** Rust, `agent-client-protocol` 0.14 (`Client.builder()`, `AcpAgent` transport, `ConnectionTo<Agent>`), Tauri async runtime, `parking_lot::Mutex` for the DB, `serde_json`, `tokio`.

**Spec:** `docs/superpowers/specs/2026-06-16-acp-native-reviews-design.md`

**Reference for exact ACP API usage:** `native/src/sessions/acp_manager.rs::run_connection` (lines 379–795) is the working, verified template for every ACP call the new driver makes (`Client.builder().name().on_receive_notification().on_receive_request().connect_with()`, `send_request(...).block_task().await`, `NewSessionRequest`, `LoadSessionRequest`, `PromptRequest`, `RequestPermissionRequest`/`Response`/`Outcome`). Mirror it.

**Testing reality (important):** This codebase does **not** unit-test live ACP I/O — `acp_manager.rs` has no mock-transport test; its live path is validated by running `pnpm desktop:dev` against a real agent, and only its **pure helpers** are unit-tested (see `acp.rs` tests). Follow that pattern: extract the reviewer's testable logic into pure functions and unit-test those; validate the live turn manually. Do **not** invent a mock ACP transport.

**All Rust commands run from `native/`.** Before the first build in a fresh worktree, run `pnpm install` at the repo root if `node_modules` is missing (the Tauri build links against it). Verify each task with:

```bash
cd native && cargo test <module> && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

`cargo fmt` reformats committed vendored files (e.g. `sessions/codex.rs`) — run `rustfmt <changed-file>` on only your file, or revert unrelated churn before committing (see memory: "cargo fmt reformats vendored codex").

---

## File Structure

- **Create** `native/src/sessions/review_runtime.rs` — the headless ACP review driver: `run_review`, `ReviewRun`, `ReviewSink`/`ReviewTarget`, the auto-approve permission handler, text accumulation + live deltas, verdict extraction + self-repair, best-effort model config-option. One responsibility: drive one headless ACP review turn and return the captured review.
- **Modify** `native/src/sessions/acp.rs` — expose `content_block_text` as `pub(super)`.
- **Modify** `native/src/sessions/acp_manager.rs` — expose `build_initialize_request` as `pub(super)`; extract the launch-argv block from `AcpManager::start` into `pub(super) fn launch_argv_for_profile`. No behavior change to chat.
- **Modify** `native/src/sessions/verdict.rs` — add the JSON-block parser `parse_verdict_block` (and `token_from_str`); later remove the line-marker API.
- **Modify** `native/src/sessions/review_loop.rs` — async `run_review`, JSON-block prompts, adapter via `parse_verdict_block`, ACP-native resume.
- **Modify** `native/src/sessions/pr_worktree.rs` — make `with_pr_worktree` async.
- **Modify** `native/src/sessions/pr_verdict.rs` — adapter via `parse_verdict_block`; drop `VERDICT_MARKER` re-export.
- **Modify** `native/src/sessions/pr_review.rs` — async `run_review`, JSON-block prompts, ACP-native resume.
- **Modify** `native/src/sessions/pr_consensus.rs` — async fan-out (`futures::future::join_all`), `run_review`, JSON-block prompts.
- **Modify** `native/src/sessions/mod.rs` — register `review_runtime`; drop `reviewer_output`.
- **Delete** `native/src/sessions/reviewer_output.rs` and the argv/spawn path in `native/src/sessions/reviewer.rs`.
- **Modify** docs: `CLAUDE.md`, `docs/architecture.md`, `docs/features.md`, `docs/tracking-and-debugging.md`, `docs/github-integration.md`.

Check `native/Cargo.toml` for the `futures` crate; if absent, the consensus fan-out uses `tokio::task::JoinSet` instead (Task 6 covers both forms).

---

## Task 1: Expose shared ACP launch + init helpers (chat unchanged)

**Files:**
- Modify: `native/src/sessions/acp.rs` (the `content_block_text` fn, ~line 330)
- Modify: `native/src/sessions/acp_manager.rs` (`build_initialize_request` ~line 1067; `AcpManager::start` argv block, lines 202–223)

- [ ] **Step 1: Expose `content_block_text`**

In `native/src/sessions/acp.rs`, change the `content_block_text` signature from `fn content_block_text(...)` to `pub(super) fn content_block_text(...)`. Do not change its body.

- [ ] **Step 2: Expose `build_initialize_request`**

In `native/src/sessions/acp_manager.rs`, change `fn build_initialize_request() -> InitializeRequest` to `pub(super) fn build_initialize_request() -> InitializeRequest`. Body unchanged.

- [ ] **Step 3: Extract `launch_argv_for_profile`**

In `native/src/sessions/acp_manager.rs`, add this function (it is the exact resolve+build block currently inlined in `AcpManager::start`, lines 202–223):

```rust
/// Resolve a provider's ACP launch into the `AcpAgent::from_args` token list:
/// login-shell env assignments, the augmented PATH, provider executable-path env,
/// the resolved binary, then its launch args. Shared by chat (`AcpManager::start`)
/// and headless reviews (`review_runtime`). See CLAUDE.md → Spawning External CLIs.
pub(super) fn launch_argv_for_profile(
    provider: &super::acp::AcpProviderDescriptor,
    profile_env: &BTreeMap<String, String>,
) -> Vec<String> {
    let path_env = crate::process_util::augmented_path()
        .to_string_lossy()
        .into_owned();
    let resolved = crate::process_util::resolve_executable(&provider.launch.command)
        .to_string_lossy()
        .into_owned();
    let provider_env = provider.executable_env.iter().map(|executable| {
        (
            executable.var.to_string(),
            crate::process_util::resolve_executable(executable.command)
                .to_string_lossy()
                .into_owned(),
        )
    });
    build_acp_argv(
        &provider.launch,
        path_env,
        resolved,
        crate::process_util::login_shell_environment(),
        provider_env,
        profile_env,
    )
}
```

Note: `provider.executable_env` is iterated by reference here (`.iter()`), so confirm the `AcpProviderDescriptor.executable_env` field and `executable.command`/`executable.var` are borrowable; if `executable_env` is consumed by value elsewhere, keep `.iter()` and clone as shown. Confirm `AcpProviderDescriptor` is `pub(super)` in `acp.rs` (it is — `acp_provider` returns it); if not, make it `pub(super)`.

- [ ] **Step 4: Call the helper from `AcpManager::start`**

Replace lines 202–223 of `AcpManager::start` (the `path_env`/`resolved`/`provider_env`/`build_acp_argv` block) with:

```rust
        let argv = launch_argv_for_profile(&provider, &agent.env);
```

Keep everything else in `start` identical.

- [ ] **Step 5: Verify chat path is unchanged**

```bash
cd native && cargo test sessions::acp && cargo test sessions::acp_manager && cargo clippy --all-targets -- -D warnings
```

Expected: PASS, no warnings. (Pure refactor — no chat test should change.)

- [ ] **Step 6: Commit**

```bash
git add native/src/sessions/acp.rs native/src/sessions/acp_manager.rs
git commit -m "refactor(acp): expose shared launch/init helpers for headless reuse"
```

---

## Task 2: JSON-block verdict parser

**Files:**
- Modify: `native/src/sessions/verdict.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `native/src/sessions/verdict.rs`:

```rust
    #[test]
    fn extracts_verdict_from_trailing_json_block() {
        let raw = "## Review\nLooks risky.\n\n```json\n{\"verdict\": \"blockers\"}\n```";
        let (token, text) = parse_verdict_block(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        assert_eq!(text, "## Review\nLooks risky.");
        assert!(!text.contains("```"));
    }

    #[test]
    fn verdict_token_is_case_insensitive() {
        let (token, _) = parse_verdict_block("ok\n```json\n{\"verdict\": \"CLEAN\"}\n```");
        assert_eq!(token, Some(VerdictToken::Clean));
    }

    #[test]
    fn last_valid_json_block_wins() {
        let raw =
            "```json\n{\"verdict\": \"feedback\"}\n```\nmore\n```json\n{\"verdict\": \"blockers\"}\n```";
        let (token, text) = parse_verdict_block(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        // Both verdict blocks are removed; only prose remains.
        assert_eq!(text, "more");
    }

    #[test]
    fn malformed_or_missing_block_yields_none_and_keeps_text() {
        assert_eq!(parse_verdict_block("Just prose.").0, None);
        assert_eq!(parse_verdict_block("```json\n{\"verdict\": \"maybe\"}\n```").0, None);
        assert_eq!(parse_verdict_block("```json\nnot json\n```").0, None);
        // A non-verdict json block is left intact in the text.
        let (token, text) = parse_verdict_block("```json\n{\"other\": 1}\n```");
        assert_eq!(token, None);
        assert!(text.contains("other"));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd native && cargo test sessions::verdict
```

Expected: FAIL — `parse_verdict_block` not found.

- [ ] **Step 3: Implement the parser**

Add to `native/src/sessions/verdict.rs` (keep the existing `VerdictToken` enum and, for now, the existing `VERDICT_MARKER`/`parse_verdict_line`/`parse_and_strip` — they are removed in Task 7):

```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct VerdictBlock {
    verdict: String,
}

/// Map a verdict string (case-insensitive) to its token, or `None` if unrecognized.
fn token_from_str(value: &str) -> Option<VerdictToken> {
    match value.trim().to_ascii_lowercase().as_str() {
        "clean" => Some(VerdictToken::Clean),
        "blockers" => Some(VerdictToken::Blockers),
        "feedback" => Some(VerdictToken::Feedback),
        _ => None,
    }
}

/// Extract the machine verdict from a reviewer's response. The reviewer ends its
/// message with a fenced ```json block carrying `{"verdict": "clean|blockers|feedback"}`.
/// The LAST block that parses to a recognized verdict wins; every recognized verdict
/// block is stripped from the returned human-facing text. A non-verdict json block
/// (or prose) is left intact. Returns `(None, trimmed_text)` when no verdict block is
/// present — there is deliberately no prose fallback.
pub(super) fn parse_verdict_block(raw: &str) -> (Option<VerdictToken>, String) {
    let lines: Vec<&str> = raw.lines().collect();
    let mut token: Option<VerdictToken> = None;
    let mut drop_ranges: Vec<(usize, usize)> = Vec::new(); // inclusive (open_fence, close_fence)
    let mut i = 0;
    while i < lines.len() {
        let fence = lines[i].trim();
        let is_json_open = fence.starts_with("```")
            && fence.trim_start_matches('`').trim().eq_ignore_ascii_case("json");
        if is_json_open {
            let mut j = i + 1;
            while j < lines.len() && lines[j].trim() != "```" {
                j += 1;
            }
            if j < lines.len() {
                let body = lines[i + 1..j].join("\n");
                if let Ok(parsed) = serde_json::from_str::<VerdictBlock>(&body) {
                    if let Some(tok) = token_from_str(&parsed.verdict) {
                        token = Some(tok); // last valid wins
                        drop_ranges.push((i, j));
                    }
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(idx, _)| !drop_ranges.iter().any(|(a, b)| idx >= a && idx <= b))
        .map(|(_, l)| *l)
        .collect();
    (token, kept.join("\n").trim().to_string())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd native && cargo test sessions::verdict
```

Expected: PASS (new tests green; existing marker tests still green — old API untouched).

- [ ] **Step 5: Commit**

```bash
git add native/src/sessions/verdict.rs
git commit -m "feat(reviews): add JSON-block verdict parser"
```

---

## Task 3: Headless ACP review driver (`review_runtime.rs`)

**Files:**
- Create: `native/src/sessions/review_runtime.rs`
- Modify: `native/src/sessions/mod.rs`

This task creates the driver and unit-tests its **pure** logic (delta accumulation, permission-option choice). The live ACP turn is validated in `pnpm desktop:dev` (Task 9), mirroring how `acp_manager.rs` is validated.

- [ ] **Step 1: Register the module**

In `native/src/sessions/mod.rs`, add `mod review_runtime;` (alongside the other `mod` lines). Leave `mod reviewer;`/`mod reviewer_output;` for now (removed in Task 7).

- [ ] **Step 2: Write the failing pure-logic tests**

Create `native/src/sessions/review_runtime.rs` with only the testable helpers and their tests first:

```rust
//! Headless ACP review driver. Runs one agent turn over ACP with no human
//! present: auto-approves every permission request, streams the agent's message
//! to the read-only Review pane, and captures the final review text plus a
//! validated verdict (with one-shot self-repair). Shared by the task review loop
//! (`review_loop.rs`), single PR reviews (`pr_review.rs`), and consensus
//! (`pr_consensus.rs`). The live turn is validated via `pnpm desktop:dev`; only
//! the pure helpers below are unit-tested, mirroring `acp_manager.rs`.

/// Append `chunk` to `full`, returning the newly-appended suffix to stream live
/// (with its start offset), or `None` when the chunk added nothing. Handles an
/// agent that re-broadcasts a cumulative snapshot (the chunk is a superset that
/// starts with what we already have) by replacing rather than double-counting.
pub(super) fn accumulate_delta(
    full: &mut String,
    streamed: &mut usize,
    chunk: &str,
) -> Option<(String, usize)> {
    if !chunk.is_empty() && chunk.starts_with(full.as_str()) {
        *full = chunk.to_string();
    } else {
        full.push_str(chunk);
    }
    if full.len() > *streamed {
        let offset = *streamed;
        let delta = full[*streamed..].to_string();
        *streamed = full.len();
        Some((delta, offset))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_chunks_stream_as_appended_deltas() {
        let mut full = String::new();
        let mut streamed = 0;
        assert_eq!(accumulate_delta(&mut full, &mut streamed, "Hello "), Some(("Hello ".to_string(), 0)));
        assert_eq!(accumulate_delta(&mut full, &mut streamed, "world"), Some(("world".to_string(), 6)));
        assert_eq!(full, "Hello world");
    }

    #[test]
    fn cumulative_rebroadcast_streams_only_the_new_tail() {
        let mut full = String::new();
        let mut streamed = 0;
        accumulate_delta(&mut full, &mut streamed, "Hello");
        // Agent re-sends the whole message so far plus more.
        assert_eq!(
            accumulate_delta(&mut full, &mut streamed, "Hello world"),
            Some((" world".to_string(), 5))
        );
        assert_eq!(full, "Hello world");
    }

    #[test]
    fn empty_or_repeated_chunk_yields_no_delta() {
        let mut full = "abc".to_string();
        let mut streamed = 3;
        assert_eq!(accumulate_delta(&mut full, &mut streamed, "abc"), None);
        assert_eq!(accumulate_delta(&mut full, &mut streamed, ""), None);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail, then pass**

```bash
cd native && cargo test sessions::review_runtime
```

Expected: FAIL first (module references unresolved if a typo), then after Step 2 compiles: PASS for the three `accumulate_delta` tests.

- [ ] **Step 4: Add the result/sink types and the self-repair prompt constant**

Append to `review_runtime.rs`:

```rust
use std::path::Path;
use std::sync::Arc;

use agent_client_protocol::schema::{
    ContentBlock, NewSessionRequest, PermissionOptionKind, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use parking_lot::Mutex as DbMutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::acp::{acp_provider, content_block_text, permission_option_id_for_kinds};
use super::acp_manager::{build_initialize_request, launch_argv_for_profile};
use super::verdict::parse_verdict_block;
use crate::db::Database;
use crate::models::{
    AgentProfile, PrReviewOutputEvent, ReviewOutputEvent, VerdictToken,
};

/// Where a review's live text is streamed: the task review pane (keyed by task id)
/// or a single PR review (keyed by review id). Consensus members stream nowhere.
pub(super) enum ReviewTarget {
    Task(i64),
    PrReview(i64),
}

/// A live-output channel for one review run.
pub(super) struct ReviewSink {
    pub app: AppHandle,
    pub target: ReviewTarget,
}

impl ReviewSink {
    fn emit(&self, data: String, start_offset: u64) {
        match self.target {
            ReviewTarget::Task(task_id) => {
                let _ = self.app.emit(
                    "review_output",
                    ReviewOutputEvent { task_id, data, start_offset },
                );
            }
            ReviewTarget::PrReview(review_id) => {
                let _ = self.app.emit(
                    "pr_review_output",
                    PrReviewOutputEvent { review_id, data, start_offset },
                );
            }
        }
    }
}

/// One review run's captured result: the human-facing review (verdict block
/// stripped), the parsed verdict (None => no clear verdict), and the ACP session
/// id to persist + resume.
pub(super) struct ReviewRun {
    pub text: String,
    pub verdict: Option<VerdictToken>,
    pub session_id: Option<String>,
}

/// Follow-up prompt sent in the same session when the first turn produced no valid
/// verdict block. Its output is parsed for the verdict but not streamed or kept.
const VERDICT_REPAIR_PROMPT: &str = "Reply with ONLY a fenced ```json block containing \
{\"verdict\": \"clean\" | \"blockers\" | \"feedback\"} and nothing else.";
```

Confirm `VerdictToken` is re-exported from `crate::models` or import it from `super::verdict` instead (it currently lives in `super::verdict`; use `super::verdict::VerdictToken` and make the enum `pub(super)` if needed). Confirm `ReviewOutputEvent`/`PrReviewOutputEvent` field names (`task_id`/`review_id`, `data`, `start_offset`) against `crate::models` — they match `reviewer.rs`'s current usage.

- [ ] **Step 5: Implement `run_review` (the headless turn)**

Append to `review_runtime.rs`. Mirror `acp_manager.rs::run_connection` (lines 379–795) for the exact builder/`connect_with`/`send_request().block_task().await` API; the differences are: headless permission handler, text-only accumulation, no persistence, single prompt + self-repair, and returning the captured result.

```rust
/// Drive one headless ACP review turn in `cwd` and return the captured review.
/// `resume` is a prior ACP session id (used via `session/load` only when the agent
/// advertises `loadSession`). `sink` streams the agent's message live; pass `None`
/// for consensus members. Custom agents have no ACP descriptor and are rejected.
pub(super) async fn run_review(
    app: AppHandle,
    db: Arc<DbMutex<Database>>,
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
    resume: Option<&str>,
    sink: Option<ReviewSink>,
) -> Result<ReviewRun, String> {
    let _ = &db; // reserved for future runtime persistence; keeps the signature uniform
    let provider = acp_provider(reviewer.agent_kind).ok_or_else(|| {
        format!(
            "{} is a Custom agent and cannot run ACP reviews; choose an ACP provider \
             (Claude, Codex, OpenCode, or Antigravity).",
            reviewer.name
        )
    })?;
    let argv = launch_argv_for_profile(&provider, &reviewer.env);
    let transport = AcpAgent::from_args(argv)
        .map_err(|error| format!("Failed to launch reviewer {}: {error}", reviewer.name))?;

    // Shared accumulators between the notification handler and the connect closure.
    let full: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let streamed: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    // While true, the notification handler accumulates+streams; set false during the
    // self-repair turn so the tiny json-only reply is neither streamed nor kept.
    let capturing: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));

    let note_full = full.clone();
    let note_streamed = streamed.clone();
    let note_capturing = capturing.clone();

    let cwd_owned = cwd.to_path_buf();
    let prompt_owned = prompt.to_string();
    let resume_owned = resume.map(str::to_string);

    let connect_result = Client
        .builder()
        .name("nectus-desktop")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update {
                    if *note_capturing.lock().await {
                        let text = content_block_text(&chunk.content);
                        if !text.is_empty() {
                            let mut full = note_full.lock().await;
                            let mut streamed = note_streamed.lock().await;
                            if let Some((delta, offset)) =
                                accumulate_delta(&mut full, &mut streamed, &text)
                            {
                                if let Some(sink) = &sink {
                                    sink.emit(delta, offset as u64);
                                }
                            }
                        }
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                // Headless: auto-approve. Prefer a one-time allow, fall back to
                // allow-always; if the agent offered no allow option, cancel.
                let option_id = permission_option_id_for_kinds(
                    &request,
                    &[PermissionOptionKind::AllowOnce, PermissionOptionKind::AllowAlways],
                );
                let outcome = match option_id {
                    Some(id) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(id),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                let _ = responder.respond(RequestPermissionResponse::new(outcome));
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, move |cx: ConnectionTo<Agent>| async move {
            let initialize = cx.send_request(build_initialize_request()).block_task().await?;
            let load_supported = initialize.agent_capabilities.load_session.unwrap_or(false);

            // session/load when resuming AND the agent supports it, else session/new.
            let session_id = if let (Some(resume), true) = (resume_owned.as_deref(), load_supported) {
                use agent_client_protocol::schema::{LoadSessionRequest, SessionId};
                let sid = SessionId::from(resume.to_string());
                cx.send_request(LoadSessionRequest::new(sid.clone(), cwd_owned.clone()))
                    .block_task()
                    .await?;
                sid
            } else {
                let new_session = cx
                    .send_request(NewSessionRequest::new(cwd_owned.clone()))
                    .block_task()
                    .await?;
                new_session.session_id
            };

            // First review turn.
            let content = vec![ContentBlock::Text(TextContent::new(prompt_owned.clone()))];
            cx.send_request(PromptRequest::new(session_id.clone(), content))
                .block_task()
                .await?;

            // Parse the verdict from the captured text.
            let first_text = full.lock().await.clone();
            let (mut verdict, mut review_text) = parse_verdict_block(&first_text);

            // One-shot self-repair: if no verdict, ask for the json block only.
            if verdict.is_none() {
                *capturing.lock().await = false; // don't stream/keep the repair reply
                let repair = vec![ContentBlock::Text(TextContent::new(
                    VERDICT_REPAIR_PROMPT.to_string(),
                ))];
                let before = full.lock().await.len();
                if cx
                    .send_request(PromptRequest::new(session_id.clone(), repair))
                    .block_task()
                    .await
                    .is_ok()
                {
                    let after = full.lock().await.clone();
                    let repair_text = after.get(before..).unwrap_or("").to_string();
                    let (repair_verdict, _) = parse_verdict_block(&repair_text);
                    verdict = repair_verdict;
                }
                // The human-facing review stays the first turn's prose (block stripped).
                review_text = parse_verdict_block(&first_text).1;
            }

            Ok::<ReviewRun, agent_client_protocol::Error>(ReviewRun {
                text: review_text,
                verdict,
                session_id: Some(session_id.to_string()),
            })
        })
        .await;

    connect_result.map_err(|error| format!("Reviewer ACP error: {error}"))
}
```

Implementation notes for the engineer:
- The exact field/method names on the ACP schema types (`initialize.agent_capabilities.load_session`, `SessionId::from`, `NewSessionRequest::new(cwd)`, `new_session.session_id`, `SessionId::to_string`) must be confirmed against `acp_manager.rs::run_connection` (lines 605–685) and the `agent-client-protocol` 0.14 `schema` module — copy the precise forms used there (e.g. chat passes `.additional_directories(...)`/`.mcp_servers(...)`; reviews omit those). If `connect_with`'s closure cannot return a non-`()` value in this crate version, capture `ReviewRun` into an `Arc<Mutex<Option<ReviewRun>>>` written inside the closure (return `Ok(())`), then read it after `connect_result`; this is the same Arc-sharing pattern the rest of the function uses.
- `permission_option_id_for_kinds(&request, &[kinds])` is the existing helper in `acp.rs` (imported via `super::acp`); confirm its signature returns `Option<String>` (the option id).
- Model selection (best-effort `SetSessionConfigOptionRequest` after session creation) is intentionally **omitted in v1** — add it only if a reviewer profile needs a non-default model; the spec marks it best-effort.

- [ ] **Step 6: Verify it compiles and pure tests pass**

```bash
cd native && cargo test sessions::review_runtime && cargo clippy --all-targets -- -D warnings
```

Expected: PASS. If the live-turn code does not compile against the crate, fix against the `acp_manager.rs` reference until `cargo build` is clean; the `accumulate_delta` tests must pass regardless.

- [ ] **Step 7: Commit**

```bash
git add native/src/sessions/review_runtime.rs native/src/sessions/mod.rs
git commit -m "feat(reviews): headless ACP review driver"
```

---

## Task 4: Task review loop on ACP

**Files:**
- Modify: `native/src/sessions/review_loop.rs`

- [ ] **Step 1: Update the verdict adapter and its tests**

In `native/src/sessions/review_loop.rs`, change the `parse_review_verdict` body to use the JSON parser, and update the `use` at the top:

Replace `use super::verdict::{parse_and_strip, VerdictToken, VERDICT_MARKER};` with `use super::verdict::{parse_verdict_block, VerdictToken};`.

Change the function body:

```rust
pub(super) fn parse_review_verdict(output: &str) -> (ReviewVerdict, String) {
    let (token, text) = parse_verdict_block(output);
    let verdict = match token {
        Some(VerdictToken::Clean) => ReviewVerdict::Pass,
        Some(VerdictToken::Blockers) => ReviewVerdict::NeedsChanges,
        Some(VerdictToken::Feedback) => ReviewVerdict::Feedback,
        None => ReviewVerdict::Unknown,
    };
    (verdict, text)
}
```

Update the adapter tests (lines ~261–307) to feed JSON blocks instead of markers, e.g.:

```rust
    #[test]
    fn maps_clean_token_to_pass() {
        assert_eq!(
            parse_review_verdict("No blockers found.\n```json\n{\"verdict\": \"clean\"}\n```").0,
            ReviewVerdict::Pass
        );
    }

    #[test]
    fn maps_blockers_token_to_needs_changes() {
        assert_eq!(
            parse_review_verdict("- lib.rs misses the command.\n```json\n{\"verdict\": \"blockers\"}\n```").0,
            ReviewVerdict::NeedsChanges
        );
    }

    #[test]
    fn maps_feedback_token_to_feedback() {
        assert_eq!(
            parse_review_verdict("Consider a helper.\n```json\n{\"verdict\": \"feedback\"}\n```").0,
            ReviewVerdict::Feedback
        );
    }

    #[test]
    fn strips_verdict_block_from_forwarded_text() {
        let (_, text) = parse_review_verdict("- missing test\n```json\n{\"verdict\": \"blockers\"}\n```");
        assert_eq!(text, "- missing test");
        assert!(!text.contains("```"));
    }

    #[test]
    fn leaves_unmarked_reviewer_output_unknown() {
        assert_eq!(
            parse_review_verdict("Blocking issue: but this is just me explaining one.").0,
            ReviewVerdict::Unknown
        );
    }
```

- [ ] **Step 2: Rewrite the prompts to request a JSON verdict block**

In `build_review_prompt` and `build_review_continuation_prompt`, remove the `marker = VERDICT_MARKER` argument and replace the verdict-instruction paragraph. Use this verdict instruction (same wording for both, adjusting "outstanding" in the continuation one):

```text
After the review, end your message with a fenced code block containing only the machine verdict, exactly:
```json
{"verdict": "blockers"}
```
Use "blockers" when there are blockers that must be fixed, "feedback" when there are no blockers but there is meaningful implementation feedback, or "clean" when there are no blockers and no material feedback. This block is stripped before the review is shown.
```

Update the prompt tests (`builds_review_prompt_without_inlining_diff`, `builds_review_continuation_prompt_for_a_resumed_reviewer`) to assert on the new content, e.g. replace the `NECTUS_VERDICT:` asserts with:

```rust
        assert!(prompt.contains("\"verdict\""));
        assert!(prompt.contains("blockers"));
        assert!(prompt.contains("clean"));
        assert!(prompt.contains("feedback"));
```

- [ ] **Step 3: Switch the runner to async + `run_review`, drop the resume-capability table**

Replace the imports and `spawn_task_review`/`run_review_round` so the reviewer call goes through the async driver. Key changes:

- Imports: remove `use super::reviewer::{reviewer_supports_resume, run_reviewer_command, ReviewOutputSink, ReviewOutputTarget};`. Add `use super::review_runtime::{run_review, ReviewSink, ReviewTarget};`.
- `spawn_task_review` body: replace `std::thread::spawn(move || { ... })` with:

```rust
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_review_round(app.clone(), db.clone(), task_id, &cwd).await {
            tracing::warn!(?error, task_id, "review failed");
            let _ = db
                .lock()
                .set_review_loop_state(task_id, ReviewLoopStatus::Error, Some(&error));
            emit_review_loop_update(&app, &db, task_id, None);
        }
    });
```

- `run_review_round` becomes `async fn`. Replace the resume block (lines 65–71) — there is no per-kind capability table anymore; every ACP reviewer can carry a session, and `run_review` decides at runtime whether `session/load` is possible:

```rust
    let resume_id = db.lock().review_loop_session_id(task_id)?;
    let resuming = resume_id.is_some();
```

- Replace the `run_reviewer_command(...)` call (lines 80–99) with:

```rust
    let sink = ReviewSink { app: app.clone(), target: ReviewTarget::Task(task_id) };
    let run_output = match run_review(
        app.clone(),
        db.clone(),
        &reviewer,
        cwd,
        &prompt,
        resume_id.as_deref(),
        Some(sink),
    )
    .await
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
```

- Replace the session-persist + verdict block (lines 101–123). The driver already returns the parsed verdict and stripped text; map the token directly:

```rust
    if !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock().set_review_loop_session_id(task_id, Some(session_id))?;
        }
    }
    let verdict = match run_output.verdict {
        Some(VerdictToken::Clean) => ReviewVerdict::Pass,
        Some(VerdictToken::Blockers) => ReviewVerdict::NeedsChanges,
        Some(VerdictToken::Feedback) => ReviewVerdict::Feedback,
        None => ReviewVerdict::Unknown,
    };
    let error = (verdict == ReviewVerdict::Unknown).then(|| UNCLEAR_REVIEW_ERROR.to_string());
    let run = db.lock().record_review_run(ReviewRunInput {
        task_id,
        reviewer_profile_id: reviewer.id,
        verdict,
        prompt,
        output: run_output.text.clone(),
        error,
    })?;
    tracing::info!(task_id, verdict = %verdict.as_str(), "recorded review");
    emit_review_loop_update(&app, &db, task_id, Some(run));
    Ok(())
```

(`parse_review_verdict` is now only used by its own unit tests; keep it for those tests and as the documented token→domain mapping, or inline-delete it if unused — clippy will flag dead code. Simplest: keep `parse_review_verdict` and call it instead of the inline match: `let (verdict, output_text) = parse_review_verdict_from_token(run_output.verdict, run_output.text);` — but to avoid a new helper, the inline match above is fine and `parse_review_verdict` can be removed along with its tests if clippy complains. Decide based on the clippy result.)

- [ ] **Step 4: Verify**

```bash
cd native && cargo test sessions::review_loop && cargo clippy --all-targets -- -D warnings
```

Expected: PASS, no warnings.

- [ ] **Step 5: Commit**

```bash
git add native/src/sessions/review_loop.rs
git commit -m "feat(reviews): run the task review loop over ACP"
```

---

## Task 5: Make `with_pr_worktree` async

**Files:**
- Modify: `native/src/sessions/pr_worktree.rs`

This must land together with Task 6 (the only callers) to keep the tree compiling — implement Task 5 and Task 6 back-to-back and run the build/commit at the end of Task 6.

- [ ] **Step 1: Convert the function to async**

Replace `with_pr_worktree` in `native/src/sessions/pr_worktree.rs` with:

```rust
/// Async variant: prepare an ephemeral worktree of PR `pr_number`'s head, run the
/// async `run` inside it, and always tear it (and its branch) down afterwards.
pub(super) async fn with_pr_worktree<T, F, Fut>(
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    repo_path: &Path,
    default_worktree_root: &str,
    pr_number: i64,
    run: F,
) -> Result<T, String>
where
    F: FnOnce(PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let branch_name = format!("nectus-pr-review-{pr_number}-{review_id}");
    let worktree_path = PathBuf::from(default_worktree_root).join(&branch_name);

    // Clear anything left by an interrupted prior run of this same review id.
    let _ = git_ops::remove_worktree(repo_path, &worktree_path, true);
    let _ = git_ops::delete_branch(repo_path, &branch_name);

    let result = async {
        git_ops::fetch_pull_request_ref(repo_path, pr_number, &branch_name)?;
        git_ops::create_worktree_at_ref(repo_path, &worktree_path, &branch_name)?;
        db.lock()
            .set_pr_review_worktree(review_id, Some(&worktree_path.to_string_lossy()))?;
        run(worktree_path.clone()).await
    }
    .await;

    // Always tear down, success or failure.
    let _ = git_ops::remove_worktree(repo_path, &worktree_path, true);
    let _ = git_ops::delete_branch(repo_path, &branch_name);
    let _ = db.lock().set_pr_review_worktree(review_id, None);

    result
}
```

(The closure now receives an owned `PathBuf` so it can be held across `.await`.)

- [ ] **Step 2: Do not build yet** — proceed directly to Task 6 (the callers). Build/commit at the end of Task 6.

---

## Task 6: PR reviews (single + consensus) on ACP

**Files:**
- Modify: `native/src/sessions/pr_verdict.rs`
- Modify: `native/src/sessions/pr_review.rs`
- Modify: `native/src/sessions/pr_consensus.rs`

- [ ] **Step 1: Update the PR verdict adapter**

In `native/src/sessions/pr_verdict.rs`: replace `use super::verdict::{parse_and_strip, VerdictToken};` with `use super::verdict::{parse_verdict_block, VerdictToken};`, delete the `pub(super) use super::verdict::VERDICT_MARKER;` re-export line, and change the body to call `parse_verdict_block`:

```rust
pub(super) fn parse_pr_review_output(raw: &str) -> (PrReviewVerdict, String) {
    let (token, text) = parse_verdict_block(raw);
    let verdict = match token {
        Some(VerdictToken::Clean) => PrReviewVerdict::Passed,
        Some(VerdictToken::Blockers) => PrReviewVerdict::Blockers,
        _ => PrReviewVerdict::Inconclusive,
    };
    (verdict, text)
}
```

Update the three `pr_verdict` tests to feed JSON blocks (e.g. ``"## Review\nBlocking: missing test.\n```json\n{\"verdict\": \"blockers\"}\n```"``) and assert the stripped text no longer contains ```` ``` ````.

- [ ] **Step 2: Add a shared PR verdict instruction**

In `native/src/sessions/pr_review.rs`, add a `pub(super)` constant the PR prompts share (replacing the marker sentences):

```rust
/// The verdict-block instruction appended to every PR review prompt (single +
/// consensus). PR reviews use only `blockers`/`clean` (never `feedback`).
pub(super) const PR_VERDICT_INSTRUCTION: &str = "After the review, end your message with a \
fenced code block containing only the machine verdict, exactly:\n\
```json\n{\"verdict\": \"blockers\"}\n```\n\
Use \"blockers\" if the review contains any blocking issue, or \"clean\" if it does not. \
This block is stripped from the review before it is shown.";
```

- [ ] **Step 3: Rewrite the single-PR prompts and make the runner async**

In `pr_review.rs`:
- Imports: remove `use super::reviewer::{...};` and the `VERDICT_MARKER` import; add `use super::review_runtime::{run_review, ReviewSink, ReviewTarget};` and `use crate::models::VerdictToken;` (or `super::verdict::VerdictToken`).
- `build_pr_review_prompt` / `build_pr_review_continuation_prompt`: drop the `marker = VERDICT_MARKER` arg and replace the final "On the final line… NECTUS_VERDICT…" sentence with `{instruction}`, passing `instruction = PR_VERDICT_INSTRUCTION`. Update the prompt tests' `NECTUS_VERDICT:` asserts to `assert!(prompt.contains("\"verdict\""))` and `assert!(prompt.contains("blockers"))`.
- `spawn_pr_review`: replace `std::thread::spawn(move || { ... })` with `tauri::async_runtime::spawn(async move { ... })` and `.await` the inner `run_pr_review`.
- `run_pr_review`: make it `async fn`. Replace the resume block (lines 66–72) with:

```rust
    let resume_id = db.lock().pr_review_session_id(review_id)?;
    let resuming = resume_id.is_some();
```

- Replace the `with_pr_worktree(...)` call (lines 83–103) with the async closure form and `run_review`:

```rust
    let sink = ReviewSink { app: app.clone(), target: ReviewTarget::PrReview(review_id) };
    let run_output = with_pr_worktree(
        db,
        review_id,
        &repo_path,
        &default_worktree_root,
        pr_number,
        |worktree_path| async move {
            let prompt = if resuming {
                build_pr_review_continuation_prompt(pr_number, &meta)
            } else {
                build_pr_review_prompt(pr_number, &meta)
            };
            run_review(
                app.clone(),
                db.clone(),
                &reviewer,
                &worktree_path,
                &prompt,
                resume_id.as_deref(),
                Some(sink),
            )
            .await
        },
    )
    .await?;
```

Note the closure now needs `app`/`db`/`reviewer`/`meta`/`resume_id`/`sink` moved or borrowed into it; adjust clones so the async closure owns what it needs (e.g. clone `meta` before the closure, move `sink` in). `db` is `&Arc<...>`; clone it for the `run_review` call.

- Replace the session-persist + verdict block (lines 105–116):

```rust
    if !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock().set_pr_review_session_id(review_id, Some(session_id))?;
        }
    }
    let verdict = match run_output.verdict {
        Some(VerdictToken::Clean) => PrReviewVerdict::Passed,
        Some(VerdictToken::Blockers) => PrReviewVerdict::Blockers,
        _ => PrReviewVerdict::Inconclusive,
    };
    db.lock().set_pr_review_result(review_id, &run_output.text, verdict)?;
    emit_pr_review_update(app, db, review_id);
    Ok(())
```

Add `use crate::models::PrReviewVerdict;` if not already imported.

- [ ] **Step 4: Convert consensus to async fan-out**

In `pr_consensus.rs`:
- Imports: remove `use super::reviewer::{reviewer_supports_resume, run_reviewer_command, ReviewerRunOutput};` and the `VERDICT_MARKER` import; add `use super::review_runtime::{run_review, ReviewRun};` and `use super::pr_review::PR_VERDICT_INSTRUCTION;`.
- `spawn_consensus_pr_review`: `std::thread::spawn` → `tauri::async_runtime::spawn(async move { ... })`, `.await` the inner runner.
- `run_consensus_pr_review` and `run_rounds_and_synthesize`: make them `async fn`. The `with_pr_worktree(...)` call becomes the async-closure form (move `app`/`db`/`reviewers`/`synthesizer`/`meta` in; the closure body `.await`s `run_rounds_and_synthesize(...)`).
- Drop the `reviewer_supports_resume` gate in the per-round plan (every reviewer carries a session now):

```rust
                let resume_id = sessions.get(&reviewer.id).cloned();
```

- Replace `run_round_parallel` (the `std::thread::scope` fan-out) with an async version that preserves input order. If `native/Cargo.toml` has `futures`:

```rust
async fn run_round_parallel(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    plans: &[(&AgentProfile, String, Option<String>)],
    worktree_path: &Path,
) -> Vec<Result<ReviewRun, String>> {
    let futures = plans.iter().map(|(reviewer, prompt, resume)| {
        run_review(
            app.clone(),
            db.clone(),
            reviewer,
            worktree_path,
            prompt,
            resume.as_deref(),
            None,
        )
    });
    futures::future::join_all(futures).await
}
```

If `futures` is **not** a dependency, use a `tokio::task::JoinSet` keyed by index and reassemble in order, or simply `await` each `run_review` in sequence inside the round loop (members are few; correctness over parallelism). Confirm against `Cargo.toml` and pick one; document the choice in a code comment.

- The per-round result handling (lines 167–195) keeps its shape but reads `run.verdict`/`run.text` via the PR mapping (use `parse_pr_review_output` on `run.text` is no longer needed — map `run.verdict` directly with the same Clean→Passed/Blockers→Blockers/else→Inconclusive match; keep `run.session_id` capture). Apply the same `match run.verdict { ... }` mapping used in Step 3.
- The synthesizer call (line 211) becomes:

```rust
    let synth_run = run_review(
        app.clone(),
        db.clone(),
        synthesizer,
        worktree_path,
        &synth_prompt,
        None,
        None,
    )
    .await?;
    let synth_verdict = match synth_run.verdict {
        Some(VerdictToken::Clean) => PrReviewVerdict::Passed,
        Some(VerdictToken::Blockers) => PrReviewVerdict::Blockers,
        _ => PrReviewVerdict::Inconclusive,
    };
    let synth_review = synth_run.text;
```

- `build_debate_prompt` / `build_synthesis_prompt`: drop the `marker = VERDICT_MARKER` arg and replace the final verdict sentence with `{instruction}` = `PR_VERDICT_INSTRUCTION`. Update the prompt tests' `NECTUS_VERDICT:` asserts to `assert!(prompt.contains("\"verdict\""))`.
- Add `use crate::models::VerdictToken;` (or `super::verdict::VerdictToken`).

- [ ] **Step 5: Build, test, commit (Tasks 5 + 6 together)**

```bash
cd native && cargo test sessions::pr_review sessions::pr_consensus sessions::pr_verdict sessions::pr_worktree && cargo clippy --all-targets -- -D warnings && cargo build
```

Expected: PASS, no warnings, clean build.

```bash
git add native/src/sessions/pr_worktree.rs native/src/sessions/pr_verdict.rs native/src/sessions/pr_review.rs native/src/sessions/pr_consensus.rs
git commit -m "feat(reviews): run single + consensus PR reviews over ACP"
```

---

## Task 7: Delete the legacy reviewer path

**Files:**
- Delete: `native/src/sessions/reviewer_output.rs`
- Modify/Delete: `native/src/sessions/reviewer.rs`
- Modify: `native/src/sessions/verdict.rs`
- Modify: `native/src/sessions/mod.rs`

- [ ] **Step 1: Remove the legacy verdict API**

In `native/src/sessions/verdict.rs`, delete `VERDICT_MARKER`, `parse_verdict_line`, `parse_and_strip`, and their tests (the marker-based `parses_each_token_case_insensitively`, `non_marker_and_unknown_value_lines_are_none`, `strips_marker_and_returns_last_token`, `drops_unrecognized_marker_line_but_keeps_prior_token`, `no_marker_yields_none_and_keeps_text`). Keep `VerdictToken`, `token_from_str`, `parse_verdict_block`, and the JSON tests.

- [ ] **Step 2: Delete the legacy reviewer modules**

```bash
cd native && git rm src/sessions/reviewer_output.rs
```

In `native/src/sessions/reviewer.rs`: the entire file is the headless-CLI launcher being replaced. Delete it too **unless** something still imports a symbol from it (grep first):

```bash
cd native && grep -rn "sessions::reviewer\b\|super::reviewer\b\|use crate::sessions::reviewer" src | grep -v reviewer_output
```

If the grep returns only the now-updated review_loop/pr_review/pr_consensus imports you already removed, delete the file: `git rm src/sessions/reviewer.rs`. If anything else references it, remove only the dead argv/spawn/`ReviewerRunOutput`/`ReviewOutputSink` items and keep the rest.

- [ ] **Step 3: Update `mod.rs`**

In `native/src/sessions/mod.rs`, remove `mod reviewer_output;` and (if the file was deleted) `mod reviewer;`. Remove any `pub(super) use` re-exports of deleted symbols.

- [ ] **Step 4: Verify the whole crate**

```bash
cd native && cargo build && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

Expected: PASS — no references to deleted symbols, all tests green, no warnings. Fix any dangling imports the compiler flags.

- [ ] **Step 5: Commit**

```bash
git add -A native/src/sessions/
git commit -m "refactor(reviews): delete legacy headless-CLI reviewer path"
```

(Use `git add -A native/src/sessions/` — scoped to the directory — not a bare `git add -A`, per memory "git add -A stages .claude worktrees".)

---

## Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/architecture.md`, `docs/features.md`, `docs/tracking-and-debugging.md`, `docs/github-integration.md`

- [ ] **Step 1: Update the backend file map in `CLAUDE.md`**

In the `native/src/sessions/` bullet: replace the `reviewer.rs` / `reviewer_output.rs` descriptions with `review_runtime.rs` (the headless ACP review driver: one `run_review` turn, auto-approve permissions, live streaming, JSON-block verdict with self-repair, shared by the task loop and both PR-review runtimes). State that **ACP is now the single agent-driving mechanism** (chat and reviews); the reviewer no longer spawns provider CLIs or parses per-provider `--json`. Note `verdict.rs` now parses a JSON block (not the `NECTUS_VERDICT:` marker). In "Spawning External CLIs", update the reviewer call-site bullet to point at `review_runtime.rs` driving an ACP session (the env/PATH layering is the same, via `launch_argv_for_profile`).

- [ ] **Step 2: Update `docs/architecture.md`**

In the "where does X live" table, change the reviewer row to `review_runtime.rs`. Replace any "two agent-driving paths (chat vs reviewer)" note with: one path — ACP — for both chat and reviews; the reviewer is a headless ACP session.

- [ ] **Step 3: Update `docs/features.md`**

Reviewer behavior is now ACP-backed (a headless agent session, not a spawned CLI). The verdict is a JSON block. **Custom agents cannot run reviews** — only ACP providers (Claude, Codex, OpenCode, Antigravity). Resume is ACP-native (`session/load` when the agent supports it).

- [ ] **Step 4: Update `docs/tracking-and-debugging.md`**

The reviewer events (`review_output`, `pr_review_output`, `review_loop_updated`, `pr_review_updated`, `pr_review_output`) are unchanged, but the runtime note moves from "headless CLI spawn" to "headless ACP session". Stored reviewer session ids are now ACP session ids; pre-upgrade ids do not resume and the first post-upgrade review starts fresh.

- [ ] **Step 5: Update `docs/github-integration.md`**

In the PR-review runtime note, state that single and consensus PR reviews run the reviewer as a headless ACP session (in the ephemeral PR worktree), not a CLI spawn.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/architecture.md docs/features.md docs/tracking-and-debugging.md docs/github-integration.md
git commit -m "docs: ACP-native reviews"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the standard verification set**

```bash
cd native && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd .. && pnpm verify
```

Expected: all green. `pnpm verify` runs the frontend build + tests; this change is backend-only, so the frontend must be unaffected. If `cargo fmt --check` flags vendored files (e.g. `sessions/codex.rs`) you did not touch, revert that churn — only your files should be formatted.

- [ ] **Step 2: Manual live validation (`pnpm desktop:dev`)**

The live ACP turn is not unit-tested (matching `acp_manager.rs`). In the running app, verify each surface against a real agent (Claude or Codex profile):

1. **Task review loop:** start a task review; confirm the reviewer's prose streams live into the read-only Review pane, the run records a verdict (Pass/NeedsChanges/Feedback), and the verdict JSON block does not appear in the stored review text.
2. **Resume:** trigger a second review round on the same task; confirm it resumes (the agent continues rather than re-deriving) when the provider supports `session/load`.
3. **Single PR review:** run a PR review; confirm the ephemeral worktree is created and torn down, the review streams, and the verdict (Passed/Blockers) is recorded.
4. **Consensus PR review:** run a 2+ reviewer consensus; confirm reviewers run concurrently, the synthesizer produces one consolidated review, and convergence/verdict are correct.
5. **Custom rejection:** select a Custom agent profile as a reviewer; confirm the review fails fast with the "Custom agents cannot run ACP reviews" message rather than hanging.
6. **Self-repair:** (best-effort) if a reviewer omits the JSON block, confirm the follow-up prompt recovers a verdict and the json-only reply is not shown in the review text.

- [ ] **Step 3: Final review**

Dispatch a code reviewer over the full branch diff (`git diff main...HEAD`) focused on: the headless permission handler (does it approve all shapes and cancel cleanly?), the self-repair control flow, async teardown of `with_pr_worktree`, and that no `tauri::async_runtime::spawn` future is accidentally non-`Send`. Address findings before opening the PR.

---

## Self-Review (plan author)

**Spec coverage:**
- Headless ACP driver → Task 3. Verdict JSON block + self-repair → Tasks 2, 3. Auto-approve permissions → Task 3. Live streaming (both events) → Task 3 (`ReviewSink`). ACP-native resume gated on `loadSession` → Task 3 + callers 4/6. Consensus async fan-out → Task 6. Caller integration (async) → Tasks 4, 6. Drop Custom → Task 3 (rejection). Deletions (`reviewer_output.rs`, `reviewer.rs`, marker) → Task 7. Docs → Task 8. Tests → pure-logic units in Tasks 2/3 + adapter/prompt units in 4/6; live validation in Task 9. Shared launch helpers (chat untouched) → Task 1. All spec sections map to a task.
- **Model config-option** is marked best-effort in the spec and explicitly deferred in Task 3 Step 5 — a conscious scope trim (YAGNI), not a gap.

**Placeholder scan:** No TBD/TODO. The two spec-sanctioned decisions (futures vs JoinSet; keep-vs-inline `parse_review_verdict`) are presented with both concrete forms and a decision rule, not left open.

**Type consistency:** `run_review(app, db, reviewer, cwd, prompt, resume, sink) -> Result<ReviewRun, String>`, `ReviewRun { text, verdict: Option<VerdictToken>, session_id }`, `ReviewSink { app, target }`, `ReviewTarget::{Task,PrReview}`, `parse_verdict_block(raw) -> (Option<VerdictToken>, String)`, `accumulate_delta(full, streamed, chunk) -> Option<(String, usize)>`, `launch_argv_for_profile(provider, profile_env) -> Vec<String>`, `build_initialize_request() -> InitializeRequest` — names are used identically across Tasks 1, 3, 4, 6. Verdict→domain mappings match the existing enums (`ReviewVerdict::{Pass,NeedsChanges,Feedback,Unknown}`, `PrReviewVerdict::{Passed,Blockers,Inconclusive}`).
</content>
