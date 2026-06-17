mod acp;
mod acp_manager;
mod pr_consensus;
mod pr_review;
mod pr_verdict;
mod pr_worktree;
mod review_loop;
mod review_runtime;
mod verdict;

use crate::db::Database;
use crate::models::{AgentProfile, ReviewRunInput, ReviewVerdict, TaskSummary};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

pub(crate) use acp::acp_provider_infos;
pub use acp_manager::AcpManager;

pub(crate) fn spawn_task_review(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    task_id: i64,
    cwd: PathBuf,
) {
    review_loop::spawn_task_review(app, db, task_id, cwd);
}

pub(crate) fn spawn_pr_review(app: AppHandle, db: Arc<Mutex<Database>>, review_id: i64) {
    pr_review::spawn_pr_review(app, db, review_id);
}

pub(crate) fn spawn_consensus_pr_review(app: AppHandle, db: Arc<Mutex<Database>>, review_id: i64) {
    pr_consensus::spawn_consensus_pr_review(app, db, review_id);
}

/// Spawn an on-demand inline review (`/review`): build the reviewer prompt (a fresh
/// review, or a continuation when a prior reviewer session is being resumed, with
/// an optional `focus` appended), run the headless ACP review that streams a
/// `Subagent` message into the task chat, then record the run and persist the
/// resolved reviewer session id (capture once, keep) — mirroring the Review-pane
/// path's recording in `review_loop::run_review_round`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_inline_review(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    chat_session_id: String,
    task: TaskSummary,
    reviewer: AgentProfile,
    cwd: PathBuf,
    resume: Option<String>,
    focus: Option<String>,
) {
    let resuming = resume.is_some();
    let mut prompt = if resuming {
        review_loop::build_review_continuation_prompt(&task)
    } else {
        review_loop::build_review_prompt(&task)
    };
    if let Some(focus) = focus.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        prompt.push_str(&format!("\n\nFocus this review on: {focus}"));
    }
    let task_id = task.id;
    let reviewer_profile_id = reviewer.id;
    let agent_profile_id = Some(reviewer.id);
    let message_id = format!("review-{}", uuid::Uuid::new_v4());
    tauri::async_runtime::spawn(async move {
        let result = review_runtime::run_inline_review(
            app,
            db.clone(),
            chat_session_id,
            task_id,
            agent_profile_id,
            reviewer,
            cwd,
            prompt.clone(),
            resume,
            message_id,
        )
        .await;
        // Record the run + persist the session id (capture once, keep), mirroring
        // the pane path's recording in `review_loop::run_review_round`.
        match result {
            Ok(run) => {
                if !resuming {
                    if let Some(sid) = run.session_id.as_deref() {
                        let _ = db.lock().set_review_loop_session_id(task_id, Some(sid));
                    }
                }
                let verdict = review_loop::verdict_from_token(run.verdict);
                let error = (verdict == ReviewVerdict::Unknown)
                    .then(|| review_loop::UNCLEAR_REVIEW_ERROR.to_string());
                if let Err(e) = db.lock().record_review_run(ReviewRunInput {
                    task_id,
                    reviewer_profile_id,
                    verdict,
                    prompt,
                    output: run.text,
                    error,
                }) {
                    tracing::warn!(?e, task_id, "failed to record inline review run");
                }
            }
            Err(error) => {
                if let Err(e) = db.lock().record_review_run(ReviewRunInput {
                    task_id,
                    reviewer_profile_id,
                    verdict: ReviewVerdict::Unknown,
                    prompt,
                    output: String::new(),
                    error: Some(error),
                }) {
                    tracing::warn!(?e, task_id, "failed to record failed inline review run");
                }
            }
        }
    });
}
