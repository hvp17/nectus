//! Task review-loop orchestration: runs a reviewer pass when a worker session
//! goes idle, records the verdict, and forwards actionable feedback back into
//! the live worker PTY. The generic reviewer launcher lives in `reviewer.rs`
//! and the PTY submission helper in `terminal_io.rs`.

use super::reviewer::{run_reviewer_command, ReviewOutputSink};
use super::terminal_io::write_agent_submission;
use super::RunningSession;
use crate::db::Database;
use crate::models::{
    ReviewLoopStatus, ReviewLoopUpdatedEvent, ReviewRunInput, ReviewVerdict, TaskSummary,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    // Stream the reviewer's stdout to the workspace so the user can watch the
    // review progress live (read-only); the full output is still captured below.
    let sink = ReviewOutputSink {
        app: app.clone(),
        task_id,
    };
    let reviewer_output = match run_reviewer_command(&reviewer, cwd, &prompt, Some(&sink)) {
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
    use crate::models::{ReviewLoopStatus, ReviewVerdict, TaskStatus, TaskSummary};

    fn task() -> TaskSummary {
        TaskSummary {
            id: 7,
            repo_id: 3,
            workspace_id: None,
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
            task_repos: Vec::new(),
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
}
