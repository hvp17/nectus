//! Generic reviewer-CLI launcher shared by every reviewing surface.
//!
//! `run_reviewer_command` spawns a reviewer agent headlessly and returns its
//! captured stdout. It is the single piece of reviewer infrastructure reused by
//! the task review loop (`review_loop.rs`), single external PR reviews
//! (`pr_review.rs`), and multi-model consensus reviews (`pr_consensus.rs`); it
//! has no task-review-loop state of its own.

use super::command::resolve_agent_command;
use crate::models::{AgentKind, AgentProfile, ReviewOutputEvent};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

/// Where to forward a reviewer's live stdout. Holds an `AppHandle` so the read
/// loop can emit `review_output` chunks keyed by `task_id` as they arrive.
pub(super) struct ReviewOutputSink {
    pub app: AppHandle,
    pub task_id: i64,
}

pub(super) fn run_reviewer_command(
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
    stream: Option<&ReviewOutputSink>,
) -> Result<String, String> {
    let executable = resolve_agent_command(&reviewer.command)?;
    let plan = build_reviewer_args(reviewer, prompt);
    let mut command = Command::new(executable);
    command.args(&plan.args);
    // A GUI-launched app has a minimal PATH, so a node-based reviewer CLI (e.g.
    // Codex) fails to exec `node`. Hand the child a PATH that includes the common
    // install dirs; a profile's own PATH still wins since its env is applied next.
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

    // Read stdout incrementally: emit each chunk for the live view while
    // accumulating the raw bytes so the recorded output is decoded cleanly once.
    // On a read error we stop the loop but still fall through to the single
    // kill/wait + stderr join below, so neither the child nor the stderr thread
    // is leaked.
    let mut stdout_bytes = Vec::new();
    let mut read_error = None;
    if let Some(mut stdout) = child.stdout.take() {
        let mut buffer = [0_u8; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let chunk = &buffer[..count];
                    if let Some(sink) = stream {
                        let _ = sink.app.emit(
                            "review_output",
                            ReviewOutputEvent {
                                task_id: sink.task_id,
                                data: String::from_utf8_lossy(chunk).to_string(),
                                start_offset: stdout_bytes.len() as u64,
                            },
                        );
                    }
                    stdout_bytes.extend_from_slice(chunk);
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
    let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    if !status.success() {
        return Err(if stderr.is_empty() {
            format!("Reviewer exited with {status}")
        } else {
            format!("Reviewer exited with {status}: {stderr}")
        });
    }
    Ok(stdout)
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
/// non-interactive entry point:
/// - Claude/Gemini: `-p <prompt>` print mode.
/// - Codex: the `exec` subcommand with the prompt as a trailing positional arg.
///   `exec` must precede the model/profile flags. Bare `codex` launches the
///   interactive TUI, which aborts with "stdin is not a terminal" when spawned
///   without a real terminal.
/// - Custom: the prompt is piped to stdin, since the command is arbitrary.
fn build_reviewer_args(reviewer: &AgentProfile, prompt: &str) -> ReviewerCommandPlan {
    let mut args = Vec::new();
    if reviewer.agent_kind == AgentKind::Codex {
        args.push("exec".to_string());
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
    let pipe_prompt_to_stdin = match reviewer.agent_kind {
        AgentKind::Claude | AgentKind::Gemini => {
            args.push("-p".to_string());
            args.push(prompt.to_string());
            false
        }
        AgentKind::Codex => {
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
    fn codex_reviewer_runs_headless_exec_with_prompt_as_positional_arg() {
        // Bare `codex` launches the interactive TUI and aborts with "stdin is
        // not a terminal" when spawned without a real terminal; the reviewer
        // must use the non-interactive `exec` subcommand instead.
        let plan = build_reviewer_args(&agent("Codex", AgentKind::Codex, "codex"), "Review this");

        assert_eq!(
            plan.args,
            vec!["exec".to_string(), "Review this".to_string()]
        );
        assert!(!plan.pipe_prompt_to_stdin);
    }

    #[test]
    fn codex_reviewer_exec_precedes_model_and_profile_args() {
        let mut profile = agent("Codex", AgentKind::Codex, "codex");
        profile.model = Some("gpt-5.3-codex".to_string());
        profile.args = vec!["--full-auto".to_string()];

        let plan = build_reviewer_args(&profile, "Review this");

        assert_eq!(
            plan.args,
            vec![
                "exec".to_string(),
                "--model".to_string(),
                "gpt-5.3-codex".to_string(),
                "--full-auto".to_string(),
                "Review this".to_string(),
            ]
        );
        assert!(!plan.pipe_prompt_to_stdin);
    }

    #[test]
    fn sends_claude_and_gemini_review_prompts_through_headless_print_mode() {
        let claude =
            build_reviewer_args(&agent("Claude", AgentKind::Claude, "claude"), "Review this");
        assert_eq!(
            claude.args,
            vec!["-p".to_string(), "Review this".to_string()]
        );
        assert!(!claude.pipe_prompt_to_stdin);

        let gemini =
            build_reviewer_args(&agent("Gemini", AgentKind::Gemini, "gemini"), "Review this");
        assert_eq!(
            gemini.args,
            vec!["-p".to_string(), "Review this".to_string()]
        );
        assert!(!gemini.pipe_prompt_to_stdin);
    }

    #[test]
    fn custom_reviewer_pipes_prompt_to_stdin() {
        let plan =
            build_reviewer_args(&agent("Custom", AgentKind::Custom, "reviewer"), "Review this");

        assert!(plan.args.is_empty());
        assert!(plan.pipe_prompt_to_stdin);
    }
}
