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
use crate::models::{
    AgentProfile, ReviewLoopUpdatedEvent, ReviewRun, ReviewRunInput, ReviewVerdict, TaskSummary,
};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(crate) use acp::acp_provider_infos;
pub use acp_manager::AcpManager;

/// Emit `review_loop_updated` so the task board + facts-rail review card pick up a
/// freshly recorded inline-review run (and its verdict). A missing loop row is a
/// no-op; the inline path always has one (`/review` requires a configured reviewer).
fn emit_review_loop_update(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    task_id: i64,
    review_run: Option<ReviewRun>,
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
/// resolved reviewer session id (capture once, keep).
///
/// `emit_agent_profile_id` is the **chat session's** profile id — the cache key the
/// frontend routes `session_chat` events to — so the live Subagent block lands in
/// the open chat. The run record uses the **reviewer's** profile id
/// (`reviewer_profile_id`) instead.
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
    emit_agent_profile_id: Option<i64>,
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
    let message_id = format!("review-{}", uuid::Uuid::new_v4());
    let emit_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = review_runtime::run_inline_review(
            app,
            db.clone(),
            chat_session_id,
            task_id,
            emit_agent_profile_id,
            reviewer,
            cwd,
            prompt.clone(),
            resume,
            message_id,
        )
        .await;
        // Record the run + persist the session id (capture once, keep), then emit
        // `review_loop_updated` so the task board + facts-rail review card refresh.
        let recorded = match result {
            Ok(run) => {
                if !resuming {
                    if let Some(sid) = run.session_id.as_deref() {
                        let _ = db.lock().set_review_loop_session_id(task_id, Some(sid));
                    }
                }
                let verdict = review_loop::verdict_from_token(run.verdict);
                let error = (verdict == ReviewVerdict::Unknown)
                    .then(|| review_loop::UNCLEAR_REVIEW_ERROR.to_string());
                match db.lock().record_review_run(ReviewRunInput {
                    task_id,
                    reviewer_profile_id,
                    verdict,
                    prompt,
                    output: run.text,
                    error,
                }) {
                    Ok(recorded) => Some(recorded),
                    Err(e) => {
                        tracing::warn!(?e, task_id, "failed to record inline review run");
                        None
                    }
                }
            }
            Err(error) => {
                match db.lock().record_review_run(ReviewRunInput {
                    task_id,
                    reviewer_profile_id,
                    verdict: ReviewVerdict::Unknown,
                    prompt,
                    output: String::new(),
                    error: Some(error),
                }) {
                    Ok(recorded) => Some(recorded),
                    Err(e) => {
                        tracing::warn!(?e, task_id, "failed to record failed inline review run");
                        None
                    }
                }
            }
        };
        emit_review_loop_update(&emit_app, &db, task_id, recorded);
    });
}
