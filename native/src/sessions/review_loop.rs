//! Task review-loop orchestration: runs a reviewer pass when a worker session
//! goes idle, records the verdict, and forwards actionable feedback back into
//! the live worker PTY. The generic reviewer launcher lives in `reviewer.rs`
//! and the PTY submission helper in `terminal_io.rs`.

use super::reviewer::{
    reviewer_supports_resume, run_reviewer_command, ReviewOutputSink, ReviewOutputTarget,
};
use super::terminal_io::write_agent_submission;
use super::verdict::{parse_and_strip, VerdictToken, VERDICT_MARKER};
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
        target: ReviewOutputTarget::Task(task_id),
    };
    let run_output =
        match run_reviewer_command(&reviewer, cwd, &prompt, resume_id.as_deref(), Some(&sink)) {
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
            db.lock()
                .set_review_loop_session_id(task_id, Some(session_id))?;
        }
    }
    // The marker line is stripped here, so the verdict noise never reaches the DB
    // record or the worker-agent feedback prompt.
    let (verdict, reviewer_output) = parse_review_verdict(&run_output.text);
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

/// Parse the reviewer's verdict from its `NECTUS_VERDICT:` marker (via the shared
/// [`super::verdict`] contract) and return it alongside the review with the marker
/// line stripped. A missing marker yields `Unknown` — there is no natural-language
/// fallback (it mis-classified reviews that merely quoted phrases like "blocking
/// issue").
pub(super) fn parse_review_verdict(output: &str) -> (ReviewVerdict, String) {
    let (token, text) = parse_and_strip(output);
    let verdict = match token {
        Some(VerdictToken::Clean) => ReviewVerdict::Pass,
        Some(VerdictToken::Blockers) => ReviewVerdict::NeedsChanges,
        Some(VerdictToken::Feedback) => ReviewVerdict::Feedback,
        None => ReviewVerdict::Unknown,
    };
    (verdict, text)
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
On the first line by itself, output one verdict token:
- {marker} BLOCKERS when there are blockers that must be fixed before this task can be accepted.
- {marker} FEEDBACK when there are no blockers, but there is meaningful implementation or approach feedback worth considering.
- {marker} CLEAN when there are no blockers and no material feedback.
This verdict line is stripped before the review is shown.

After a BLOCKERS verdict, list only concise blockers with file paths when possible.
After a FEEDBACK verdict, list concise non-blocking implementation or approach suggestions.
Do not mark style nits or minor preference differences as blockers.
",
        title = task.title,
        brief = task.prompt.as_deref().unwrap_or("No task brief provided."),
        marker = VERDICT_MARKER,
    )
}

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
On the first line by itself, output one verdict token:
- {marker} BLOCKERS when blockers remain or new ones appeared.
- {marker} FEEDBACK when there are no blockers, but there is meaningful implementation or approach feedback worth considering.
- {marker} CLEAN when there are no blockers and no material feedback.
This verdict line is stripped before the review is shown.

After a BLOCKERS verdict, list only the concise outstanding blockers with file paths when possible.
After a FEEDBACK verdict, list concise non-blocking implementation or approach suggestions.
",
        title = task.title,
        marker = VERDICT_MARKER,
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
            attention: None,
            jira_issue_key: None,
            jira_issue_summary: None,
            jira_issue_url: None,
            task_repos: Vec::new(),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn maps_clean_token_to_pass() {
        assert_eq!(
            parse_review_verdict("NECTUS_VERDICT: CLEAN\nNo blockers found.").0,
            ReviewVerdict::Pass
        );
    }

    #[test]
    fn maps_blockers_token_to_needs_changes() {
        assert_eq!(
            parse_review_verdict(
                "NECTUS_VERDICT: BLOCKERS\n- native/src/lib.rs misses the command registration."
            )
            .0,
            ReviewVerdict::NeedsChanges
        );
    }

    #[test]
    fn maps_feedback_token_to_feedback() {
        assert_eq!(
            parse_review_verdict("NECTUS_VERDICT: FEEDBACK\nConsider a smaller helper.").0,
            ReviewVerdict::Feedback
        );
    }

    #[test]
    fn strips_marker_from_forwarded_review_text() {
        let (_, text) = parse_review_verdict("NECTUS_VERDICT: BLOCKERS\n- missing test");
        assert_eq!(text, "- missing test");
        assert!(!text.contains("NECTUS_VERDICT"));
    }

    #[test]
    fn leaves_unmarked_reviewer_output_unknown() {
        // No marker and no natural-language fallback: "blocking issue" in prose
        // must NOT be classified — only the explicit token decides.
        assert_eq!(
            parse_review_verdict("Blocking issue: but this is just me explaining one.").0,
            ReviewVerdict::Unknown
        );
        assert_eq!(
            parse_review_verdict("Looks reasonable overall.").0,
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
        assert!(prompt.contains("NECTUS_VERDICT: CLEAN"));
        assert!(prompt.contains("NECTUS_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_VERDICT: FEEDBACK"));
    }

    #[test]
    fn builds_review_continuation_prompt_for_a_resumed_reviewer() {
        let prompt = build_review_continuation_prompt(&task());

        assert!(prompt.contains("Implement settings panel"));
        assert!(prompt.to_lowercase().contains("already reviewed"));
        assert!(prompt.contains("git diff --no-ext-diff HEAD --"));
        assert!(prompt.contains("NECTUS_VERDICT: CLEAN"));
        assert!(prompt.contains("NECTUS_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_VERDICT: FEEDBACK"));
        assert!(!prompt.contains("diff --git"));
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
