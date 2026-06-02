use super::rows::{pr_review_from_row, rows};
use super::{now, Database};
use crate::git_ops;
use crate::models::{PrReview, PrReviewStatus, PrReviewVerdict, Repo};
use rusqlite::{params, OptionalExtension};
use std::path::Path;

/// Shared joined projection for `pr_reviews`, column order matching
/// [`super::rows::pr_review_from_row`]. Repo name is required (inner join);
/// reviewer name is nullable (the profile may have been deleted).
const PR_REVIEW_SELECT: &str = "
    SELECT
      pr.id, pr.repo_id, r.name, pr.reviewer_profile_id, a.name,
      pr.pr_url, pr.pr_number, pr.pr_title, pr.pr_author, pr.base_branch,
      pr.status, pr.review_output, pr.last_error, pr.worktree_path,
      pr.created_at, pr.updated_at, pr.verdict
    FROM pr_reviews pr
    JOIN repos r ON r.id = pr.repo_id
    LEFT JOIN agent_profiles a ON a.id = pr.reviewer_profile_id
";

impl Database {
    /// Find the known project whose default remote matches `owner/repo`.
    pub fn resolve_repo_for_owner_repo(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Option<Repo>, String> {
        for candidate in self.list_repos()? {
            if let Some((remote_owner, remote_repo)) =
                git_ops::remote_owner_repo(Path::new(&candidate.path))
            {
                if remote_owner.eq_ignore_ascii_case(owner)
                    && remote_repo.eq_ignore_ascii_case(repo)
                {
                    return Ok(Some(candidate));
                }
            }
        }
        Ok(None)
    }

    pub fn create_pr_review(
        &self,
        repo_id: i64,
        reviewer_profile_id: i64,
        pr_url: &str,
        pr_number: i64,
    ) -> Result<PrReview, String> {
        self.repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        self.agent_profile_by_id(reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;

        let now = now();
        self.conn
            .execute(
                "
                INSERT INTO pr_reviews
                  (repo_id, reviewer_profile_id, pr_url, pr_number, status, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                ",
                params![
                    repo_id,
                    reviewer_profile_id,
                    pr_url,
                    pr_number,
                    PrReviewStatus::Queued.as_str(),
                    now
                ],
            )
            .map_err(|error| format!("Failed to create PR review: {error}"))?;

        self.pr_review_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "PR review was saved but could not be loaded".to_string())
    }

    pub fn list_pr_reviews(&self) -> Result<Vec<PrReview>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!("{PR_REVIEW_SELECT} ORDER BY pr.id DESC"))
            .map_err(|error| error.to_string())?;
        let result = rows(stmt
            .query_map([], pr_review_from_row)
            .map_err(|error| error.to_string())?);
        result
    }

    pub fn pr_review_by_id(&self, id: i64) -> Result<Option<PrReview>, String> {
        self.conn
            .query_row(
                &format!("{PR_REVIEW_SELECT} WHERE pr.id = ?1"),
                params![id],
                pr_review_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn set_pr_review_status(
        &self,
        id: i64,
        status: PrReviewStatus,
        last_error: Option<&str>,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET status = ?1, last_error = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), last_error, now(), id],
        )
    }

    pub fn set_pr_review_meta(
        &self,
        id: i64,
        title: Option<&str>,
        author: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET pr_title = ?1, pr_author = ?2, base_branch = ?3, updated_at = ?4 WHERE id = ?5",
            params![title, author, base_branch, now(), id],
        )
    }

    pub fn set_pr_review_worktree(
        &self,
        id: i64,
        worktree_path: Option<&str>,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET worktree_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![worktree_path, now(), id],
        )
    }

    pub fn set_pr_review_result(
        &self,
        id: i64,
        output: &str,
        verdict: PrReviewVerdict,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET review_output = ?1, verdict = ?2, status = ?3, last_error = NULL, updated_at = ?4 WHERE id = ?5",
            params![output, verdict.as_str(), PrReviewStatus::Ready.as_str(), now(), id],
        )
    }

    /// Reset a finished review back to `queued` and clear its prior
    /// output/verdict/error so the runtime can re-fetch the PR head and review
    /// again.
    pub fn reset_pr_review_for_rerun(&self, id: i64) -> Result<PrReview, String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET status = ?1, review_output = NULL, verdict = NULL, last_error = NULL, updated_at = ?2 WHERE id = ?3",
            params![PrReviewStatus::Queued.as_str(), now(), id],
        )?;
        self.pr_review_by_id(id)?
            .ok_or_else(|| "PR review not found".to_string())
    }

    pub fn delete_pr_review(&self, id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM pr_reviews WHERE id = ?1", params![id])
            .map_err(|error| format!("Failed to delete PR review: {error}"))?;
        Ok(())
    }

    fn execute_pr_review_update(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
    ) -> Result<(), String> {
        let changed = self
            .conn
            .execute(sql, params)
            .map_err(|error| format!("Failed to update PR review: {error}"))?;
        if changed == 0 {
            return Err("PR review not found".to_string());
        }
        Ok(())
    }
}
