use super::command::resolve_agent_command;
use super::RunningSession;
use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, ReviewLoopStatus, ReviewLoopUpdatedEvent, ReviewRunInput,
    ReviewVerdict, TaskSummary,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const UNCLEAR_REVIEW_ERROR: &str = "Reviewer output did not include a clear verdict";
const TERMINAL_SUBMIT_KEY_DELAY: Duration = Duration::from_millis(60);

pub(super) fn spawn_review_on_session_idle(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: String,
    cwd: PathBuf,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_review_round(
            app.clone(),
            db.clone(),
            sessions,
            task_id,
            &session_id,
            &cwd,
        ) {
            tracing::warn!(?error, task_id, session_id = %session_id, "review failed");
            let _ = db
                .lock()
                .set_review_loop_state(task_id, ReviewLoopStatus::Error, Some(&error));
            emit_review_loop_update(&app, &db, task_id, None);
        }
    });
}

fn run_review_round(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: &str,
    cwd: &Path,
) -> Result<(), String> {
    let (task, reviewer) = {
        let database = db.lock();
        let Some(review_loop) = database.review_loop_by_task_id(task_id)? else {
            return Ok(());
        };
        if review_loop.status != ReviewLoopStatus::Running {
            return Ok(());
        }
        let task = database
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        let reviewer = database
            .agent_profile_by_id(review_loop.reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;
        database.set_review_loop_state(task_id, ReviewLoopStatus::Reviewing, None)?;
        (task, reviewer)
    };
    emit_review_loop_update(&app, &db, task_id, None);

    let prompt = build_review_prompt(&task);
    tracing::info!(task_id, reviewer = %reviewer.name, "starting review");
    let reviewer_output = match run_reviewer_command(&reviewer, cwd, &prompt) {
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
    let verdict = parse_review_verdict(&reviewer_output);
    let error = (verdict == ReviewVerdict::Unknown).then(|| UNCLEAR_REVIEW_ERROR.to_string());
    let run = db.lock().record_review_run(ReviewRunInput {
        task_id,
        reviewer_profile_id: reviewer.id,
        verdict,
        prompt,
        output: reviewer_output.clone(),
        error,
    })?;
    tracing::info!(task_id, verdict = %verdict.as_str(), "recorded review");
    emit_review_loop_update(&app, &db, task_id, Some(run));

    let Some(review_loop) = db.lock().review_loop_by_task_id(task_id)? else {
        return Ok(());
    };
    if should_forward_review_feedback(verdict, review_loop.status) {
        let feedback = format_worker_review_feedback(&reviewer_output);
        send_worker_feedback(sessions, session_id, &feedback)?;
    }

    Ok(())
}

fn emit_review_loop_update(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    task_id: i64,
    review_run: Option<crate::models::ReviewRun>,
) {
    let Ok(Some(review_loop)) = db.lock().review_loop_by_task_id(task_id) else {
        return;
    };
    let _ = app.emit(
        "review_loop_updated",
        ReviewLoopUpdatedEvent {
            task_id,
            review_loop,
            review_run,
        },
    );
}

pub(super) fn run_reviewer_command(
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
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
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to read reviewer output: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("Reviewer exited with {}", output.status)
        } else {
            format!("Reviewer exited with {}: {stderr}", output.status)
        });
    }
    Ok(stdout)
}

pub(super) fn write_agent_submission(writer: &mut dyn Write, input: &str) -> std::io::Result<()> {
    writer.write_all(input.as_bytes())?;
    // Raw-mode TUIs can treat text plus Enter delivered in one burst as pasted text.
    writer.flush()?;
    std::thread::sleep(TERMINAL_SUBMIT_KEY_DELAY);
    writer.write_all(b"\r")?;
    writer.flush()
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

fn send_worker_feedback(
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    session_id: &str,
    feedback: &str,
) -> Result<(), String> {
    let mut sessions = sessions.lock();
    let running = sessions
        .get_mut(session_id)
        .ok_or_else(|| "Worker session stopped before review feedback could be sent".to_string())?;
    write_agent_submission(running.writer.as_mut(), feedback)
        .map_err(|error| format!("Failed to send review feedback to worker agent: {error}"))
}

pub(super) fn parse_review_verdict(output: &str) -> ReviewVerdict {
    for line in output.lines() {
        let line = line.trim();
        if line.eq_ignore_ascii_case("pass") || line.to_ascii_lowercase().starts_with("pass:") {
            return ReviewVerdict::Pass;
        }
        if line.eq_ignore_ascii_case("NECTUS_NO_BLOCKERS") {
            return ReviewVerdict::Pass;
        }
        if line.eq_ignore_ascii_case("NECTUS_BLOCKERS") {
            return ReviewVerdict::NeedsChanges;
        }
        if line.eq_ignore_ascii_case("NECTUS_FEEDBACK") {
            return ReviewVerdict::Feedback;
        }
    }

    let normalized = output.to_ascii_lowercase();
    if normalized.contains("blocking issue")
        || normalized.contains("needs changes")
        || normalized.contains("request changes")
        || normalized.contains("must fix")
    {
        return ReviewVerdict::NeedsChanges;
    }

    ReviewVerdict::Unknown
}

pub(super) fn build_review_prompt(task: &TaskSummary) -> String {
    format!(
        "\
You are reviewing an implementation produced by another agent.

Task title:
{title}

Task brief:
{brief}

You are running in the task worktree. Inspect the implementation yourself before reviewing.
Start from:
- git status --short
- git diff --no-ext-diff HEAD --

Review only for blocking correctness issues, regressions, missing tests, unsafe behavior, or clear requirement misses.
Return one exact verdict token on the first line:
- NECTUS_BLOCKERS when there are blockers that must be fixed before this task can be accepted.
- NECTUS_FEEDBACK when there are no blockers, but there is meaningful implementation or approach feedback worth considering.
- NECTUS_NO_BLOCKERS when there are no blockers and no material feedback.

After NECTUS_BLOCKERS, list only concise blockers with file paths when possible.
After NECTUS_FEEDBACK, list concise non-blocking implementation or approach suggestions.
Do not mark style nits or minor preference differences as blockers.
",
        title = task.title,
        brief = task.prompt.as_deref().unwrap_or("No task brief provided.")
    )
}

pub(super) fn format_worker_review_feedback(reviewer_output: &str) -> String {
    format!(
        "\
AI reviewer returned this review:

{reviewer_output}

Decide which findings are valid, make the necessary code or test changes, and explain any review feedback you intentionally do not apply.
",
        reviewer_output = reviewer_output.trim()
    )
}

fn should_forward_review_feedback(verdict: ReviewVerdict, status: ReviewLoopStatus) -> bool {
    matches!(
        verdict,
        ReviewVerdict::NeedsChanges | ReviewVerdict::Feedback
    ) && matches!(
        status,
        ReviewLoopStatus::Running | ReviewLoopStatus::FeedbackSent
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AgentKind, AgentProfile, ReviewVerdict, TaskStatus, TaskSummary};
    use std::io;

    #[derive(Debug, PartialEq)]
    enum WriteEvent {
        Write(Vec<u8>),
        Flush,
    }

    #[derive(Default)]
    struct RecordingWriter {
        events: Vec<WriteEvent>,
    }

    impl Write for RecordingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.events.push(WriteEvent::Write(buf.to_vec()));
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.events.push(WriteEvent::Flush);
            Ok(())
        }
    }

    fn task() -> TaskSummary {
        TaskSummary {
            id: 7,
            repo_id: 3,
            title: "Implement settings panel".to_string(),
            prompt: Some("Add project settings with tests".to_string()),
            status: TaskStatus::InProgress,
            pr_url: None,
            agent_profile_id: Some(1),
            agent_name: Some("Codex".to_string()),
            agent_kind: None,
            has_worktree: true,
            branch_name: Some("feat/settings".to_string()),
            worktree_path: Some("/tmp/repo-worktrees/feat/settings".to_string()),
            is_dirty: true,
            active_session_id: Some("session-1".to_string()),
            last_session_id: Some("session-1".to_string()),
            last_session_agent: Some("codex".to_string()),
            last_session_cwd: Some("/tmp/repo-worktrees/feat/settings".to_string()),
            last_session_label: None,
            review_loop_status: None,
            jira_issue_key: None,
            jira_issue_summary: None,
            jira_issue_url: None,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

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
    fn parses_reviewer_pass_verdict() {
        assert_eq!(
            parse_review_verdict("PASS\nNo blocking issues."),
            ReviewVerdict::Pass
        );
    }

    #[test]
    fn parses_reviewer_no_blockers_sentinel_as_pass() {
        assert_eq!(
            parse_review_verdict("NECTUS_NO_BLOCKERS\nNo blockers found."),
            ReviewVerdict::Pass
        );
    }

    #[test]
    fn parses_reviewer_blockers_sentinel_as_needs_changes() {
        assert_eq!(
            parse_review_verdict(
                "NECTUS_BLOCKERS\n- native/src/lib.rs misses the command registration."
            ),
            ReviewVerdict::NeedsChanges
        );
    }

    #[test]
    fn parses_reviewer_feedback_sentinel_as_feedback() {
        assert_eq!(
            parse_review_verdict("NECTUS_FEEDBACK\nConsider splitting this into a smaller helper."),
            ReviewVerdict::Feedback
        );
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

    #[test]
    fn parses_reviewer_blocking_issue_as_needs_changes() {
        let output = "Blocking issue: src/App.tsx drops the saved reviewer profile.";

        assert_eq!(parse_review_verdict(output), ReviewVerdict::NeedsChanges);
    }

    #[test]
    fn leaves_unclear_reviewer_output_unknown() {
        assert_eq!(
            parse_review_verdict("Looks reasonable overall."),
            ReviewVerdict::Unknown
        );
    }

    #[test]
    fn builds_review_prompt_without_inlining_diff() {
        let prompt = build_review_prompt(&task());

        assert!(prompt.contains("Implement settings panel"));
        assert!(prompt.contains("Add project settings with tests"));
        assert!(prompt.contains("git diff --no-ext-diff HEAD --"));
        assert!(!prompt.contains("diff --git a/src/App.tsx b/src/App.tsx"));
        assert!(prompt.contains("NECTUS_NO_BLOCKERS"));
        assert!(prompt.contains("NECTUS_BLOCKERS"));
        assert!(prompt.contains("NECTUS_FEEDBACK"));
    }

    #[test]
    fn formats_review_feedback_for_worker_agent() {
        let feedback = format_worker_review_feedback("Blocking issue: missing test");

        assert!(feedback.contains("AI reviewer returned this review"));
        assert!(!feedback.contains("round"));
        assert!(feedback.contains("Blocking issue: missing test"));
        assert!(feedback.contains("Decide which findings are valid"));
    }

    #[test]
    fn forwards_single_review_feedback_after_terminal_review() {
        assert!(should_forward_review_feedback(
            ReviewVerdict::Feedback,
            ReviewLoopStatus::FeedbackSent
        ));
        assert!(should_forward_review_feedback(
            ReviewVerdict::NeedsChanges,
            ReviewLoopStatus::FeedbackSent
        ));
        assert!(!should_forward_review_feedback(
            ReviewVerdict::Pass,
            ReviewLoopStatus::Passed
        ));
    }

    #[test]
    fn writes_agent_submission_with_terminal_enter() {
        let mut output = Vec::new();

        write_agent_submission(&mut output, "Line 1\nLine 2").unwrap();

        assert_eq!(output, b"Line 1\nLine 2\r");
    }

    #[test]
    fn flushes_agent_submission_before_sending_terminal_enter() {
        let mut output = RecordingWriter::default();

        write_agent_submission(&mut output, "Create the pull request").unwrap();

        assert_eq!(
            output.events,
            [
                WriteEvent::Write(b"Create the pull request".to_vec()),
                WriteEvent::Flush,
                WriteEvent::Write(b"\r".to_vec()),
                WriteEvent::Flush,
            ]
        );
    }
}
