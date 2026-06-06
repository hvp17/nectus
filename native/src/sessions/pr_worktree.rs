//! Shared ephemeral-worktree scaffold for external PR reviews.
//!
//! Both the single (`pr_review.rs`) and consensus (`pr_consensus.rs`) runtimes
//! check out a PR head into a throwaway worktree, run reviewer(s) in it, and tear
//! it down. [`with_pr_worktree`] owns that lifecycle — unique-per-run naming,
//! pre-clean, fetch + create, persisting the path, and guaranteed teardown — so
//! the two runtimes can't drift and the collision/branch-leak fixes live once.

use crate::db::Database;
use crate::git_ops;
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Prepare an ephemeral worktree of PR `pr_number`'s head, run `run` inside it,
/// and always tear it (and its branch) down afterwards.
///
/// The branch/worktree are named `nectus-pr-review-<pr>-<review_id>` so concurrent
/// reviews of the same PR (a single + a consensus review, or two reviews of one
/// PR) never collide on the path or share a branch. The branch is deleted on
/// teardown so reviewed PRs don't leave a trail of `nectus-pr-review-*` branches.
pub(super) fn with_pr_worktree<T>(
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    repo_path: &Path,
    default_worktree_root: &str,
    pr_number: i64,
    run: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let branch_name = format!("nectus-pr-review-{pr_number}-{review_id}");
    let worktree_path = PathBuf::from(default_worktree_root).join(&branch_name);

    // Clear anything left by an interrupted prior run of this same review id.
    let _ = git_ops::remove_worktree(repo_path, &worktree_path, true);
    let _ = git_ops::delete_branch(repo_path, &branch_name);

    let result = (|| {
        git_ops::fetch_pull_request_ref(repo_path, pr_number, &branch_name)?;
        git_ops::create_worktree_at_ref(repo_path, &worktree_path, &branch_name)?;
        db.lock()
            .set_pr_review_worktree(review_id, Some(&worktree_path.to_string_lossy()))?;
        run(&worktree_path)
    })();

    // Always tear down — worktree, ephemeral branch, and the persisted path —
    // whether or not the review succeeded.
    let _ = git_ops::remove_worktree(repo_path, &worktree_path, true);
    let _ = git_ops::delete_branch(repo_path, &branch_name);
    let _ = db.lock().set_pr_review_worktree(review_id, None);

    result
}
