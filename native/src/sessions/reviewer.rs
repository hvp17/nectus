//! Generic reviewer-CLI launcher shared by every reviewing surface.
//!
//! `run_reviewer_command` spawns a reviewer agent headlessly and returns its
//! captured stdout. It is the single piece of reviewer infrastructure reused by
//! the task review loop (`review_loop.rs`), single external PR reviews
//! (`pr_review.rs`), and multi-model consensus reviews (`pr_consensus.rs`); it
//! has no task-review-loop state of its own.
// Legacy headless-CLI reviewer; superseded by review_runtime.rs, deleted in a follow-up task.
#![allow(dead_code)]

use super::command::resolve_agent_command;
use super::reviewer_output::{ReviewerOutputCollector, ReviewerWire};
use crate::models::{AgentKind, AgentProfile, PrReviewOutputEvent, ReviewOutputEvent};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

/// Which live-output channel a reviewer run streams to. The task review loop and
/// single PR reviews both forward the reviewer's stdout live, but key it
/// differently (task id vs review id) and emit a different event.
pub(super) enum ReviewOutputTarget {
    Task(i64),
    PrReview(i64),
}

/// Where to forward a reviewer's live stdout. Holds an `AppHandle` so the read
/// loop can emit output chunks (keyed by its [`ReviewOutputTarget`]) as they
/// arrive.
pub(super) struct ReviewOutputSink {
    pub app: AppHandle,
    pub target: ReviewOutputTarget,
}

impl ReviewOutputSink {
    /// Emit one decoded text delta to the sink's channel: `review_output` keyed by
    /// task id for the task loop, `pr_review_output` keyed by review id for a
    /// single PR review.
    fn emit(&self, data: String, start_offset: u64) {
        match self.target {
            ReviewOutputTarget::Task(task_id) => {
                let _ = self.app.emit(
                    "review_output",
                    ReviewOutputEvent {
                        task_id,
                        data,
                        start_offset,
                    },
                );
            }
            ReviewOutputTarget::PrReview(review_id) => {
                let _ = self.app.emit(
                    "pr_review_output",
                    PrReviewOutputEvent {
                        review_id,
                        data,
                        start_offset,
                    },
                );
            }
        }
    }
}

/// The result of one reviewer run: the human-facing review text and the resolved
/// session id to persist and resume (None for providers without resume support,
/// or when capture failed).
pub(super) struct ReviewerRunOutput {
    pub text: String,
    pub session_id: Option<String>,
}

/// Whether a reviewer kind can resume a prior conversation. Claude mints its own
/// id (`--session-id`/`--resume`); Codex and OpenCode mint internally and we
/// capture + resume by id. Antigravity/Custom have no supported resume path.
pub(super) fn reviewer_supports_resume(kind: AgentKind) -> bool {
    matches!(
        kind,
        AgentKind::Claude | AgentKind::Codex | AgentKind::OpenCode
    )
}

/// Mint a fresh reviewer session id for Claude's `--session-id` (requires a
/// UUID).
pub(super) fn new_reviewer_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

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
        AgentKind::Claude => resume
            .map(str::to_string)
            .or_else(|| claude_start_id.clone()),
        _ => None,
    };

    let plan = build_reviewer_args(reviewer, prompt, resume, claude_start_id.as_deref());
    let mut command = Command::new(executable);
    command.args(&plan.args);
    // A GUI-launched app inherits a minimal environment, so seed the child with
    // the user's login-shell env (provider API keys like OPENAI_API_KEY live there)
    // for terminal parity, then set a PATH that includes the common install dirs so
    // a node-based reviewer CLI (e.g. Codex, OpenCode) can exec `node`. A profile's
    // own env/PATH still wins since it is applied last.
    for (key, value) in crate::process_util::login_shell_environment() {
        command.env(key, value);
    }
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
    // Keep the raw stdout too: JSON-wire reviewers (Codex/OpenCode) report a
    // failure on stdout and exit non-zero with an empty stderr, so this is the
    // last-resort diagnostic when no structured error event was recognized.
    let mut raw_stdout = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let mut buffer = [0_u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    raw_stdout.push_str(&String::from_utf8_lossy(&buffer[..count]));
                    let delta = collector.push(&buffer[..count]);
                    if !delta.is_empty() {
                        if let Some(sink) = stream {
                            sink.emit(delta.clone(), streamed_len);
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
    let (text, session_id, errors) = collector.finish();
    if !status.success() {
        // Surface whatever the reviewer actually reported. stderr is the natural
        // home, but the JSON-wire reviewers leave it empty and report failures on
        // stdout, so fall back to the parsed error event, then the raw output.
        let detail = first_non_empty([stderr.as_str(), errors.as_str(), raw_stdout.trim()]);
        return Err(match detail {
            Some(detail) => format!("Reviewer exited with {status}: {}", truncate_detail(detail)),
            None => format!("Reviewer exited with {status}"),
        });
    }
    Ok(ReviewerRunOutput { text, session_id })
}

/// First non-empty (after trimming) candidate, used to pick the most specific
/// failure detail to report.
fn first_non_empty<'a>(candidates: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    candidates
        .into_iter()
        .map(str::trim)
        .find(|s| !s.is_empty())
}

/// Cap a raw-output diagnostic so a chatty reviewer's stdout can't flood the
/// error message; keep the tail, where the failure usually is.
fn truncate_detail(detail: &str) -> String {
    const MAX: usize = 2000;
    let chars: Vec<char> = detail.chars().collect();
    if chars.len() <= MAX {
        return detail.to_string();
    }
    let tail: String = chars[chars.len() - MAX..].iter().collect();
    format!("…{tail}")
}

/// Argv and stdin handling for launching a reviewer CLI headlessly.
struct ReviewerCommandPlan {
    /// Full argument list passed to the reviewer executable, in order.
    args: Vec<String>,
    /// When true the prompt is written to the child's stdin; otherwise the
    /// prompt is already included in `args`.
    pipe_prompt_to_stdin: bool,
}

/// Build the headless invocation for a reviewer. Each agent kind has a distinct
/// non-interactive entry point and resume form:
/// - Claude/Antigravity: `-p <prompt>` print mode. Claude adds `--session-id <uuid>`
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
        AgentKind::Claude | AgentKind::Antigravity | AgentKind::Custom => {}
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
    // handled in the subcommand block above; Antigravity/Custom have no resume.
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
        AgentKind::Claude | AgentKind::Antigravity => {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AgentKind, AgentProfile};

    fn agent(name: &str, agent_kind: AgentKind, command: &str) -> AgentProfile {
        AgentProfile {
            id: 1,
            name: name.to_string(),
            agent_kind,
            command: command.to_string(),
            model: None,
            args: Vec::new(),
            env: Default::default(),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

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
            vec![
                "exec".to_string(),
                "--json".to_string(),
                "Review this".to_string()
            ]
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
    fn sends_claude_and_antigravity_review_prompts_through_headless_print_mode() {
        let claude = build_reviewer_args(
            &agent("Claude", AgentKind::Claude, "claude"),
            "Review this",
            None,
            None,
        );
        assert_eq!(
            claude.args,
            vec!["-p".to_string(), "Review this".to_string()]
        );

        let antigravity = build_reviewer_args(
            &agent("Antigravity", AgentKind::Antigravity, "agy"),
            "Review this",
            None,
            None,
        );
        assert_eq!(
            antigravity.args,
            vec!["-p".to_string(), "Review this".to_string()]
        );
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
        assert!(!reviewer_supports_resume(AgentKind::Antigravity));
        assert!(!reviewer_supports_resume(AgentKind::Custom));
    }

    #[test]
    fn new_reviewer_session_id_is_a_unique_uuid() {
        let a = new_reviewer_session_id();
        let b = new_reviewer_session_id();
        assert_eq!(a.len(), 36);
        assert_ne!(a, b);
    }

    #[test]
    fn first_non_empty_prefers_the_first_meaningful_candidate() {
        // stderr wins when present.
        assert_eq!(first_non_empty(["boom", "parsed", "raw"]), Some("boom"));
        // Blank/whitespace-only candidates are skipped (the JSON-wire case where
        // stderr is empty but a parsed error event exists).
        assert_eq!(
            first_non_empty(["", "  \n ", "parsed error", "raw"]),
            Some("parsed error")
        );
        assert_eq!(first_non_empty(["", "   "]), None);
    }

    #[test]
    fn truncate_detail_keeps_short_output_and_tails_long_output() {
        assert_eq!(truncate_detail("short"), "short");
        let long: String = "x".repeat(2500);
        let truncated = truncate_detail(&long);
        assert!(truncated.starts_with('…'));
        // The tail (where the failure usually is) is preserved, capped at MAX.
        assert_eq!(truncated.chars().filter(|c| *c == 'x').count(), 2000);
    }
}
