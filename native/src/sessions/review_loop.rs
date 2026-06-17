//! Task review-loop orchestration: runs a headless reviewer pass in the task
//! worktree, records the verdict, and streams the reviewer's live output. The
//! headless ACP review driver lives in `review_runtime.rs`.

use super::review_runtime::{run_review, ReviewSink, ReviewTarget};
use super::verdict::VerdictToken;
use crate::db::Database;
use crate::models::{
    ReviewLoopStatus, ReviewLoopUpdatedEvent, ReviewRunInput, ReviewVerdict, TaskSummary,
};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(super) const UNCLEAR_REVIEW_ERROR: &str =
    "Reviewer output did not include a clear verdict";

pub(super) fn spawn_task_review(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    task_id: i64,
    cwd: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_review_round(app.clone(), db.clone(), task_id, &cwd).await {
            tracing::warn!(?error, task_id, "review failed");
            let _ = db
                .lock()
                .set_review_loop_state(task_id, ReviewLoopStatus::Error, Some(&error));
            emit_review_loop_update(&app, &db, task_id, None);
        }
    });
}

async fn run_review_round(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    task_id: i64,
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
    // The driver only sends `session/load` when the agent advertises it, so a
    // non-resume-capable reviewer simply starts a fresh session.
    let resume_id = db.lock().review_loop_session_id(task_id)?;
    let resuming = resume_id.is_some();
    let prompt = if resuming {
        build_review_continuation_prompt(&task)
    } else {
        build_review_prompt(&task)
    };
    tracing::info!(task_id, reviewer = %reviewer.name, resuming, "starting review");
    // Stream the reviewer's message to the workspace so the user can watch the
    // review progress live (read-only); the full output is still captured below.
    let sink = ReviewSink {
        app: app.clone(),
        target: ReviewTarget::Task(task_id),
    };
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

    // Capture once, keep: persist the resolved id only when we did not already
    // have one, so the canonical thread (esp. for Codex/OpenCode) is the one we
    // keep resuming.
    if !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock()
                .set_review_loop_session_id(task_id, Some(session_id))?;
        }
    }
    // The driver already parsed the verdict and stripped its block from the text,
    // so the verdict noise never reaches the DB record or the worker-agent prompt.
    let verdict = verdict_from_token(run_output.verdict);
    let error = (verdict == ReviewVerdict::Unknown).then(|| UNCLEAR_REVIEW_ERROR.to_string());
    let run = db.lock().record_review_run(ReviewRunInput {
        task_id,
        reviewer_profile_id: reviewer.id,
        verdict,
        prompt,
        output: run_output.text,
        error,
    })?;
    tracing::info!(task_id, verdict = %verdict.as_str(), "recorded review");
    emit_review_loop_update(&app, &db, task_id, Some(run));

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

/// Map the shared verdict token to the task-review domain enum. A missing verdict
/// (`None`) is `Unknown`, surfaced to the user as an unclear-review error.
pub(super) fn verdict_from_token(token: Option<VerdictToken>) -> ReviewVerdict {
    match token {
        Some(VerdictToken::Clean) => ReviewVerdict::Pass,
        Some(VerdictToken::Blockers) => ReviewVerdict::NeedsChanges,
        Some(VerdictToken::Feedback) => ReviewVerdict::Feedback,
        None => ReviewVerdict::Unknown,
    }
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
List concise blockers with file paths when possible, then any concise non-blocking implementation or approach suggestions.
Do not mark style nits or minor preference differences as blockers.

After the review, end your message with a fenced code block containing only the machine verdict, exactly:
```json
{{\"verdict\": \"blockers\"}}
```
Use \"blockers\" when there are blockers that must be fixed, \"feedback\" when there are no blockers but there is meaningful implementation feedback, or \"clean\" when there are no blockers and no material feedback. This block is stripped before the review is shown.
",
        title = task.title,
        brief = task.prompt.as_deref().unwrap_or("No task brief provided."),
    )
}

pub(super) fn build_review_continuation_prompt(task: &TaskSummary) -> String {
    format!(
        "\
You reviewed this task earlier and the author has since responded to your feedback. Review it again.

Task title:
{title}

Task brief (for reference):
{brief}

Re-inspect what changed since your last review:
- git status --short
- git diff --no-ext-diff HEAD --

If you recall your prior findings, do not re-derive the whole review — confirm whether your earlier blockers were addressed and whether the latest changes introduced new ones. If you do not have that context, review the current state against the brief. Report the outstanding blockers with file paths when possible, then any concise non-blocking suggestions.

After the review, end your message with a fenced code block containing only the machine verdict, exactly:
```json
{{\"verdict\": \"blockers\"}}
```
Use \"blockers\" when blockers remain or new ones appeared, \"feedback\" when there are no blockers but there is meaningful implementation feedback, or \"clean\" when there are no blockers and no material feedback. This block is stripped before the review is shown.
",
        title = task.title,
        brief = task.prompt.as_deref().unwrap_or("No task brief provided."),
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
            active_session_id: None,
            last_session_id: None,
            last_session_agent: None,
            last_session_cwd: None,
            last_session_label: None,
            review_loop_status: None,
            attention: None,
            archived: false,
            jira_issue_key: None,
            jira_issue_summary: None,
            jira_issue_url: None,
            task_repos: Vec::new(),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn maps_tokens_to_review_verdicts() {
        assert_eq!(
            verdict_from_token(Some(VerdictToken::Clean)),
            ReviewVerdict::Pass
        );
        assert_eq!(
            verdict_from_token(Some(VerdictToken::Blockers)),
            ReviewVerdict::NeedsChanges
        );
        assert_eq!(
            verdict_from_token(Some(VerdictToken::Feedback)),
            ReviewVerdict::Feedback
        );
        assert_eq!(verdict_from_token(None), ReviewVerdict::Unknown);
    }

    #[test]
    fn builds_review_prompt_without_inlining_diff() {
        let prompt = build_review_prompt(&task());

        assert!(prompt.contains("Implement settings panel"));
        assert!(prompt.contains("Add project settings with tests"));
        assert!(prompt.contains("git diff --no-ext-diff HEAD --"));
        assert!(!prompt.contains("diff --git a/src/App.tsx b/src/App.tsx"));
        assert!(prompt.contains("\"verdict\""));
        assert!(prompt.contains("blockers"));
        assert!(prompt.contains("clean"));
        assert!(prompt.contains("feedback"));
    }

    #[test]
    fn builds_review_continuation_prompt_for_a_resumed_reviewer() {
        let prompt = build_review_continuation_prompt(&task());

        assert!(prompt.contains("Implement settings panel"));
        // The brief is included so a cold-resumed session (an agent without
        // `session/load`) still has the task context, not just the title.
        assert!(prompt.contains("Add project settings with tests"));
        assert!(prompt.to_lowercase().contains("reviewed this task earlier"));
        assert!(prompt.contains("git diff --no-ext-diff HEAD --"));
        assert!(prompt.contains("\"verdict\""));
        assert!(prompt.contains("blockers"));
        assert!(prompt.contains("clean"));
        assert!(prompt.contains("feedback"));
        assert!(!prompt.contains("diff --git"));
    }
}
