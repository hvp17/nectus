mod acp;
mod acp_manager;
mod command;
mod pr_consensus;
mod pr_review;
mod pr_verdict;
mod pr_worktree;
mod review_loop;
mod review_runtime;
mod reviewer;
mod reviewer_output;
mod verdict;

use crate::db::Database;
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
