use super::review_loop::run_reviewer_command;
use crate::db::Database;
use crate::github::{self, PrMeta};
use crate::git_ops;
use crate::models::{PrReviewStatus, PrReviewUpdatedEvent};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Run a queued PR review on a background thread: fetch metadata, check out the
/// PR head into an ephemeral worktree, run the reviewer headless, store the
/// Markdown review, and always tear the worktree down.
pub(super) fn spawn_pr_review(app: AppHandle, db: Arc<Mutex<Database>>, review_id: i64) {
    std::thread::spawn(move || {
        if let Err(error) = run_pr_review(&app, &db, review_id) {
            tracing::warn!(?error, review_id, "pr review failed");
            let _ = db
                .lock()
                .set_pr_review_status(review_id, PrReviewStatus::Error, Some(&error));
            emit_pr_review_update(&app, &db, review_id);
        }
    });
}

fn run_pr_review(app: &AppHandle, db: &Arc<Mutex<Database>>, review_id: i64) -> Result<(), String> {
    let (pr_number, repo_path, default_worktree_root, reviewer) = {
        let database = db.lock();
        let review = database
            .pr_review_by_id(review_id)?
            .ok_or_else(|| "PR review not found".to_string())?;
        let repo = database
            .repo_by_id(review.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let reviewer = database
            .agent_profile_by_id(review.reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;
        database.set_pr_review_status(review_id, PrReviewStatus::Reviewing, None)?;
        (review.pr_number, repo.path, repo.default_worktree_root, reviewer)
    };
    emit_pr_review_update(app, db, review_id);

    let repo_path = PathBuf::from(&repo_path);

    // Backfill PR metadata so the list and detail show title/author/base.
    let meta = github::fetch_pull_request_meta(&repo_path, pr_number)?;
    db.lock().set_pr_review_meta(
        review_id,
        Some(&meta.title),
        meta.author.as_deref(),
        meta.base_branch.as_deref(),
    )?;
    emit_pr_review_update(app, db, review_id);

    let branch_name = format!("nectus-pr-review-{pr_number}");
    let worktree_path = PathBuf::from(&default_worktree_root).join(&branch_name);
    // Clear any worktree left by a previous run before re-adding.
    let _ = git_ops::remove_worktree(&repo_path, &worktree_path);

    let output = review_in_worktree(
        db,
        review_id,
        &repo_path,
        &worktree_path,
        &branch_name,
        pr_number,
        &reviewer,
        &meta,
    );

    // Always tear the worktree down, whether or not the review succeeded.
    let _ = git_ops::remove_worktree(&repo_path, &worktree_path);
    let _ = db.lock().set_pr_review_worktree(review_id, None);

    let output = output?;
    db.lock().set_pr_review_result(review_id, &output)?;
    emit_pr_review_update(app, db, review_id);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn review_in_worktree(
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    pr_number: i64,
    reviewer: &crate::models::AgentProfile,
    meta: &PrMeta,
) -> Result<String, String> {
    git_ops::fetch_pull_request_ref(repo_path, pr_number, branch_name)?;
    git_ops::create_worktree_at_ref(repo_path, worktree_path, branch_name)?;
    db.lock()
        .set_pr_review_worktree(review_id, Some(&worktree_path.to_string_lossy()))?;

    let prompt = build_pr_review_prompt(pr_number, meta);
    run_reviewer_command(reviewer, worktree_path, &prompt)
}

fn emit_pr_review_update(app: &AppHandle, db: &Arc<Mutex<Database>>, review_id: i64) {
    let Ok(Some(pr_review)) = db.lock().pr_review_by_id(review_id) else {
        return;
    };
    let _ = app.emit("pr_review_updated", PrReviewUpdatedEvent { pr_review });
}

pub(super) fn build_pr_review_prompt(pr_number: i64, meta: &PrMeta) -> String {
    let author = meta.author.as_deref().unwrap_or("unknown");
    let base = meta.base_branch.as_deref().unwrap_or("the base branch");
    format!(
        "\
You are reviewing GitHub pull request #{pr_number} for a human reviewer who will paste your review back to the author.

PR title: {title}
Author: {author}
Base branch: {base}

You are in a checked-out worktree of the PR branch. Inspect the actual changes yourself before reviewing. If the base ref is missing locally, run `git fetch origin {base}` first, then start from:
- git log --oneline origin/{base}..HEAD
- git diff origin/{base}...HEAD

Write a clear, specific code review in GitHub-flavored Markdown that the reviewer can paste directly into the pull request. Structure it as:
- A one or two sentence summary of what the PR does and your overall assessment.
- Blocking issues: correctness, regressions, security, or missing tests, each with the file path and a concrete fix. Omit this section if there are none.
- Non-blocking suggestions and nits, clearly marked as optional.
- Anything done well that is worth keeping.

Reference real files and lines. Do not invent issues; if the PR looks solid, say so plainly. Output only the Markdown review, with no preamble before it or sign-off after it.",
        pr_number = pr_number,
        title = meta.title,
        author = author,
        base = base,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_review_prompt_includes_details_and_no_verdict_tokens() {
        let meta = PrMeta {
            title: "Add request caching".to_string(),
            author: Some("octocat".to_string()),
            base_branch: Some("main".to_string()),
        };

        let prompt = build_pr_review_prompt(42, &meta);

        assert!(prompt.contains("#42"));
        assert!(prompt.contains("Add request caching"));
        assert!(prompt.contains("octocat"));
        assert!(prompt.contains("origin/main...HEAD"));
        assert!(prompt.to_lowercase().contains("markdown"));
        // PR review output is for a human, not the marker-parsing review loop.
        assert!(!prompt.contains("NECTUS_"));
    }

    #[test]
    fn pr_review_prompt_tolerates_missing_author_and_base() {
        let meta = PrMeta {
            title: "Tidy up".to_string(),
            author: None,
            base_branch: None,
        };

        let prompt = build_pr_review_prompt(7, &meta);

        assert!(prompt.contains("#7"));
        assert!(prompt.contains("Tidy up"));
        assert!(prompt.contains("unknown"));
    }
}
