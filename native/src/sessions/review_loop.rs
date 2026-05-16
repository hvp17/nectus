use super::command::resolve_agent_command;
use super::RunningSession;
use crate::db::Database;
use crate::models::{
    AgentProfile, ReviewLoopStatus, ReviewLoopUpdatedEvent, ReviewRunInput, ReviewVerdict,
    TaskSummary,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const UNCLEAR_REVIEW_ERROR: &str = "Reviewer output did not include a clear verdict";

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
            tracing::warn!(?error, task_id, session_id = %session_id, "review round failed");
            let _ = db.lock().set_review_loop_state(
                task_id,
                ReviewLoopStatus::Error,
                None,
                Some(&error),
            );
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
    let (review_loop, task, reviewer) = {
        let database = db.lock();
        let Some(review_loop) = database.review_loop_by_task_id(task_id)? else {
            return Ok(());
        };
        if review_loop.status != ReviewLoopStatus::Running {
            return Ok(());
        }
        if review_loop.current_round >= review_loop.max_rounds {
            database.set_review_loop_state(
                task_id,
                ReviewLoopStatus::MaxRoundsReached,
                None,
                None,
            )?;
            drop(database);
            emit_review_loop_update(&app, &db, task_id, None);
            return Ok(());
        }
        let task = database
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        let reviewer = database
            .agent_profile_by_id(review_loop.reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;
        database.set_review_loop_state(task_id, ReviewLoopStatus::Reviewing, None, None)?;
        (review_loop, task, reviewer)
    };

    let round = review_loop.current_round + 1;
    let prompt = build_review_prompt(&task);
    tracing::info!(task_id, round, reviewer = %reviewer.name, "starting review round");
    let reviewer_output = match run_reviewer_command(&reviewer, cwd, &prompt) {
        Ok(output) => output,
        Err(error) => {
            let run = db.lock().record_review_run(ReviewRunInput {
                task_id,
                round,
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
        round,
        reviewer_profile_id: reviewer.id,
        verdict,
        prompt,
        output: reviewer_output.clone(),
        error,
    })?;
    tracing::info!(task_id, round, verdict = %verdict.as_str(), "recorded review round");
    emit_review_loop_update(&app, &db, task_id, Some(run));

    let Some(review_loop) = db.lock().review_loop_by_task_id(task_id)? else {
        return Ok(());
    };
    if verdict == ReviewVerdict::NeedsChanges && review_loop.status == ReviewLoopStatus::Running {
        let feedback = format_worker_review_feedback(round, &reviewer_output);
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

fn run_reviewer_command(
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
) -> Result<String, String> {
    let executable = resolve_agent_command(&reviewer.command)?;
    let mut command = Command::new(executable);
    if let Some(model) = reviewer
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--model");
        command.arg(model);
    }
    for arg in &reviewer.args {
        command.arg(arg);
    }
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
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|error| format!("Failed to send review prompt: {error}"))?;
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

fn send_worker_feedback(
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    session_id: &str,
    feedback: &str,
) -> Result<(), String> {
    let mut sessions = sessions.lock();
    let running = sessions
        .get_mut(session_id)
        .ok_or_else(|| "Worker session stopped before review feedback could be sent".to_string())?;
    writeln!(running.writer, "{feedback}")
        .map_err(|error| format!("Failed to send review feedback to worker agent: {error}"))
}

pub(super) fn parse_review_verdict(output: &str) -> ReviewVerdict {
    for line in output.lines() {
        let line = line.trim();
        if line.eq_ignore_ascii_case("pass") || line.to_ascii_lowercase().starts_with("pass:") {
            return ReviewVerdict::Pass;
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
Respond with PASS if there are no blocking issues.
If there are blocking issues, write concise findings beginning with \"Blocking issue:\" and include file paths when possible.
",
        title = task.title,
        brief = task.prompt.as_deref().unwrap_or("No task brief provided.")
    )
}

pub(super) fn format_worker_review_feedback(round: i64, reviewer_output: &str) -> String {
    format!(
        "\
AI reviewer round {round} returned this review:

{reviewer_output}

Decide which findings are valid, make the necessary code or test changes, and explain any review feedback you intentionally do not apply.
",
        reviewer_output = reviewer_output.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReviewVerdict, TaskStatus, TaskSummary};

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
        assert!(prompt.contains("Respond with PASS"));
    }

    #[test]
    fn formats_review_feedback_for_worker_agent() {
        let feedback = format_worker_review_feedback(2, "Blocking issue: missing test");

        assert!(feedback.contains("AI reviewer round 2"));
        assert!(feedback.contains("Blocking issue: missing test"));
        assert!(feedback.contains("Decide which findings are valid"));
    }
}
