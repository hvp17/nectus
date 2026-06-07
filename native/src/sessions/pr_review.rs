use super::pr_verdict::{parse_pr_review_output, PR_VERDICT_MARKER};
use super::pr_worktree::with_pr_worktree;
use super::reviewer::{reviewer_supports_resume, run_reviewer_command};
use crate::db::Database;
use crate::github::{self, PrMeta};
use crate::models::{PrReviewStatus, PrReviewUpdatedEvent};
use parking_lot::Mutex;
use std::path::PathBuf;
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

    // Resume a prior review session on rerun so the reviewer continues its
    // earlier review of the (now updated) PR instead of starting cold. Only
    // resume-capable reviewers (Claude/Codex/OpenCode) carry a session.
    let supports_resume = reviewer_supports_resume(reviewer.agent_kind);
    let resume_id = if supports_resume {
        db.lock().pr_review_session_id(review_id)?
    } else {
        None
    };
    let resuming = resume_id.is_some();

    // The shared scaffold owns the ephemeral worktree lifecycle (unique naming,
    // pre-clean, fetch+create, persist path, guaranteed teardown incl. branch).
    let run_output = with_pr_worktree(
        db,
        review_id,
        &repo_path,
        &default_worktree_root,
        pr_number,
        |worktree_path| {
            let prompt = if resuming {
                build_pr_review_continuation_prompt(pr_number, &meta)
            } else {
                build_pr_review_prompt(pr_number, &meta)
            };
            // PR reviews surface their output through the Reviews view, not the
            // live task workspace, so they keep the captured-output path.
            run_reviewer_command(&reviewer, worktree_path, &prompt, resume_id.as_deref(), None)
        },
    )?;

    // Capture once, keep: persist the resolved id only on the first run.
    if supports_resume && !resuming {
        if let Some(session_id) = run_output.session_id.as_deref() {
            db.lock().set_pr_review_session_id(review_id, Some(session_id))?;
        }
    }

    let (verdict, review_output) = parse_pr_review_output(&run_output.text);
    db.lock()
        .set_pr_review_result(review_id, &review_output, verdict)?;
    emit_pr_review_update(app, db, review_id);
    Ok(())
}

fn emit_pr_review_update(app: &AppHandle, db: &Arc<Mutex<Database>>, review_id: i64) {
    let Ok(Some(pr_review)) = db.lock().pr_review_by_id(review_id) else {
        return;
    };
    let _ = app.emit(
        "pr_review_updated",
        PrReviewUpdatedEvent {
            pr_review,
            latest_run: None,
        },
    );
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

Reference real files and lines. Do not invent issues; if the PR looks solid, say so plainly. Output only the Markdown review, with no preamble before it.

After the review, on the final line by itself, output a machine-readable verdict: exactly `{marker} BLOCKERS` if you listed any blocking issues, or `{marker} CLEAN` if there were none. This line is stripped from the review before it is shown.",
        pr_number = pr_number,
        title = meta.title,
        author = author,
        base = base,
        marker = PR_VERDICT_MARKER,
    )
}

pub(super) fn build_pr_review_continuation_prompt(pr_number: i64, meta: &PrMeta) -> String {
    let base = meta.base_branch.as_deref().unwrap_or("the base branch");
    format!(
        "\
You already reviewed GitHub pull request #{pr_number} earlier in this same conversation. It has since been updated, and you are reviewing it again for a human who will paste your review back to the author.

PR title: {title}
Base branch: {base}

You are in a fresh checkout of the current PR head. Re-inspect only what changed since your last review:
- git log --oneline origin/{base}..HEAD
- git diff origin/{base}...HEAD

You already remember your previous review — do not re-derive it from scratch. Update it: confirm which earlier findings are now resolved, keep the ones that still apply, and add any new issues the latest changes introduced.

Write the updated review in GitHub-flavored Markdown that the reviewer can paste directly into the pull request (summary, blocking issues with file paths, non-blocking suggestions, what's done well). Output only the Markdown review, with no preamble before it.

On the final line by itself, output the verdict: exactly `{marker} BLOCKERS` if the updated review contains any blocking issue, or `{marker} CLEAN` if it does not. This line is stripped from the review before it is shown.",
        pr_number = pr_number,
        title = meta.title,
        base = base,
        marker = PR_VERDICT_MARKER,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_review_prompt_includes_details_and_requests_verdict_marker() {
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
        // The reviewer is asked to append a machine-readable verdict marker so
        // the Done state can distinguish passed from blocking.
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: CLEAN"));
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

    #[test]
    fn pr_review_continuation_prompt_asks_for_a_delta_update_and_verdict() {
        let meta = PrMeta {
            title: "Add request caching".to_string(),
            author: Some("octocat".to_string()),
            base_branch: Some("main".to_string()),
        };

        let prompt = build_pr_review_continuation_prompt(42, &meta);

        assert!(prompt.contains("#42"));
        assert!(prompt.contains("Add request caching"));
        assert!(prompt.to_lowercase().contains("already reviewed"));
        assert!(prompt.contains("origin/main...HEAD"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: CLEAN"));
    }
}
