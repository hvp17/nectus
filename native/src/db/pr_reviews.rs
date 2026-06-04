use super::rows::{
    pr_review_from_row, pr_review_reviewer_from_row, pr_review_run_from_row, rows,
};
use super::{now, Database};
use crate::git_ops;
use crate::models::{
    PrReview, PrReviewConsensus, PrReviewReviewer, PrReviewStatus, PrReviewVerdict, Repo,
};
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
      pr.created_at, pr.updated_at, pr.verdict, pr.consensus_json
    FROM pr_reviews pr
    JOIN repos r ON r.id = pr.repo_id
    LEFT JOIN agent_profiles a ON a.id = pr.reviewer_profile_id
";

/// Shared joined projection for `pr_review_runs`, column order matching
/// [`super::rows::pr_review_run_from_row`].
const PR_REVIEW_RUN_SELECT: &str = "
    SELECT
      prr.id, prr.pr_review_id, prr.reviewer_profile_id, a.name,
      prr.round, prr.verdict, prr.output, prr.error, prr.created_at
    FROM pr_review_runs prr
    LEFT JOIN agent_profiles a ON a.id = prr.reviewer_profile_id
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

    /// Create a multi-model consensus review. The first id is the synthesizer that
    /// writes the final consolidated review; all ids participate each round. The
    /// reviewer roster + an empty convergence matrix are stored immediately so the
    /// UI shows the consensus shape while the review is still queued.
    pub fn create_consensus_pr_review(
        &self,
        repo_id: i64,
        reviewer_profile_ids: &[i64],
        rounds: i64,
        pr_url: &str,
        pr_number: i64,
    ) -> Result<PrReview, String> {
        self.repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let primary = *reviewer_profile_ids
            .first()
            .ok_or_else(|| "Consensus review needs at least one reviewer".to_string())?;

        let mut reviewers = Vec::with_capacity(reviewer_profile_ids.len());
        for (index, id) in reviewer_profile_ids.iter().enumerate() {
            let profile = self
                .agent_profile_by_id(*id)?
                .ok_or_else(|| "Reviewer profile not found".to_string())?;
            reviewers.push(PrReviewReviewer {
                profile_id: profile.id,
                name: profile.name.clone(),
                agent_kind: Some(profile.agent_kind),
                synthesizer: index == 0,
            });
        }

        let consensus = PrReviewConsensus {
            reviewers,
            rounds: Vec::new(),
            max_rounds: rounds.max(1),
            converged: false,
            converged_in_rounds: None,
        };
        let consensus_json = serde_json::to_string(&consensus).map_err(|error| error.to_string())?;
        let ids_json =
            serde_json::to_string(reviewer_profile_ids).map_err(|error| error.to_string())?;
        let now = now();
        self.conn
            .execute(
                "
                INSERT INTO pr_reviews
                  (repo_id, reviewer_profile_id, reviewer_profile_ids, rounds, consensus_json,
                   pr_url, pr_number, status, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                ",
                params![
                    repo_id,
                    primary,
                    ids_json,
                    rounds.max(1),
                    consensus_json,
                    pr_url,
                    pr_number,
                    PrReviewStatus::Queued.as_str(),
                    now
                ],
            )
            .map_err(|error| format!("Failed to create consensus PR review: {error}"))?;

        self.pr_review_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "PR review was saved but could not be loaded".to_string())
    }

    /// The reviewer roster and configured max rounds for a consensus review, or
    /// `None` for a single-reviewer review (fewer than two reviewers).
    pub fn pr_review_consensus_config(&self, id: i64) -> Result<Option<(Vec<i64>, i64)>, String> {
        let row: Option<(Option<String>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT reviewer_profile_ids, rounds FROM pr_reviews WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((Some(ids_json), rounds)) = row else {
            return Ok(None);
        };
        let ids: Vec<i64> =
            serde_json::from_str(&ids_json).map_err(|error| error.to_string())?;
        if ids.len() < 2 {
            return Ok(None);
        }
        Ok(Some((ids, rounds.unwrap_or(1).max(1))))
    }

    /// Persist the (possibly partial) convergence matrix so the UI can show it
    /// filling in round by round.
    pub fn set_pr_review_consensus(
        &self,
        id: i64,
        consensus: &PrReviewConsensus,
    ) -> Result<(), String> {
        let json = serde_json::to_string(consensus).map_err(|error| error.to_string())?;
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET consensus_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![json, now(), id],
        )
    }

    pub fn list_pr_reviews(&self) -> Result<Vec<PrReview>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!("{PR_REVIEW_SELECT} ORDER BY pr.id DESC"))
            .map_err(|error| error.to_string())?;
        let mut reviews = rows(stmt
            .query_map([], pr_review_from_row)
            .map_err(|error| error.to_string())?)?;
        for review in &mut reviews {
            if review.mode == PrReviewMode::Consensus {
                review.reviewers = self.list_pr_review_reviewers(review.id)?;
            }
        }
        Ok(reviews)
    }

    pub fn pr_review_by_id(&self, id: i64) -> Result<Option<PrReview>, String> {
        let review = self
            .conn
            .query_row(
                &format!("{PR_REVIEW_SELECT} WHERE pr.id = ?1"),
                params![id],
                pr_review_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        match review {
            Some(mut review) => {
                if review.mode == PrReviewMode::Consensus {
                    review.reviewers = self.list_pr_review_reviewers(review.id)?;
                }
                Ok(Some(review))
            }
            None => Ok(None),
        }
    }

    /// Create a multi-model consensus review: the parent row records the
    /// synthesizer (`synthesizer_profile_id`, which also surfaces as the review's
    /// reviewer name) and the round cap, and each participating reviewer is
    /// recorded in `pr_review_reviewers`. Requires at least two distinct
    /// reviewers; duplicates are rejected by the join table's primary key.
    pub fn create_consensus_pr_review(
        &self,
        repo_id: i64,
        synthesizer_profile_id: i64,
        reviewer_profile_ids: &[i64],
        max_rounds: i64,
        pr_url: &str,
        pr_number: i64,
    ) -> Result<PrReview, String> {
        self.repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        if reviewer_profile_ids.len() < 2 {
            return Err("A consensus review needs at least two reviewers".to_string());
        }
        for reviewer_profile_id in reviewer_profile_ids {
            self.agent_profile_by_id(*reviewer_profile_id)?
                .ok_or_else(|| "Reviewer profile not found".to_string())?;
        }

        let now = now();
        self.conn
            .execute(
                "
                INSERT INTO pr_reviews
                  (repo_id, reviewer_profile_id, pr_url, pr_number, status, mode, max_rounds, rounds_completed, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)
                ",
                params![
                    repo_id,
                    synthesizer_profile_id,
                    pr_url,
                    pr_number,
                    PrReviewStatus::Queued.as_str(),
                    PrReviewMode::Consensus.as_str(),
                    max_rounds,
                    now
                ],
            )
            .map_err(|error| format!("Failed to create consensus PR review: {error}"))?;

        let review_id = self.conn.last_insert_rowid();
        for (position, reviewer_profile_id) in reviewer_profile_ids.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT INTO pr_review_reviewers (pr_review_id, reviewer_profile_id, position) VALUES (?1, ?2, ?3)",
                    params![review_id, reviewer_profile_id, position as i64],
                )
                .map_err(|error| format!("Failed to add consensus reviewer: {error}"))?;
        }

        self.pr_review_by_id(review_id)?
            .ok_or_else(|| "PR review was saved but could not be loaded".to_string())
    }

    /// The reviewers participating in a consensus review, in selection order.
    pub fn list_pr_review_reviewers(
        &self,
        pr_review_id: i64,
    ) -> Result<Vec<PrReviewReviewer>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT prr.reviewer_profile_id, a.name
                FROM pr_review_reviewers prr
                LEFT JOIN agent_profiles a ON a.id = prr.reviewer_profile_id
                WHERE prr.pr_review_id = ?1
                ORDER BY prr.position
                ",
            )
            .map_err(|error| error.to_string())?;
        let result = rows(stmt
            .query_map(params![pr_review_id], pr_review_reviewer_from_row)
            .map_err(|error| error.to_string())?);
        result
    }

    /// Record one reviewer's output for one consensus round and return it with
    /// the reviewer's display name resolved.
    pub fn record_pr_review_run(&self, input: PrReviewRunInput) -> Result<PrReviewRun, String> {
        self.conn
            .execute(
                "
                INSERT INTO pr_review_runs
                  (pr_review_id, reviewer_profile_id, round, verdict, output, error, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    input.pr_review_id,
                    input.reviewer_profile_id,
                    input.round,
                    input.verdict.as_str(),
                    input.output,
                    input.error,
                    now()
                ],
            )
            .map_err(|error| format!("Failed to record review round: {error}"))?;
        let run_id = self.conn.last_insert_rowid();
        self.conn
            .query_row(
                &format!("{PR_REVIEW_RUN_SELECT} WHERE prr.id = ?1"),
                params![run_id],
                pr_review_run_from_row,
            )
            .map_err(|error| format!("Failed to load recorded review round: {error}"))
    }

    /// All round outputs for a consensus review, oldest first.
    pub fn list_pr_review_runs(&self, pr_review_id: i64) -> Result<Vec<PrReviewRun>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!("{PR_REVIEW_RUN_SELECT} WHERE prr.pr_review_id = ?1 ORDER BY prr.id"))
            .map_err(|error| error.to_string())?;
        let result = rows(stmt
            .query_map(params![pr_review_id], pr_review_run_from_row)
            .map_err(|error| error.to_string())?);
        result
    }

    /// Mark how many parallel rounds have finished, so the UI can show progress
    /// while a consensus run is mid-flight.
    pub fn set_pr_review_progress(
        &self,
        id: i64,
        rounds_completed: i64,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET rounds_completed = ?1, updated_at = ?2 WHERE id = ?3",
            params![rounds_completed, now(), id],
        )
    }

    /// Store the synthesized consensus result and whether the reviewers converged.
    pub fn set_pr_review_consensus(
        &self,
        id: i64,
        output: &str,
        verdict: PrReviewVerdict,
        converged: bool,
    ) -> Result<(), String> {
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET review_output = ?1, verdict = ?2, converged = ?3, status = ?4, last_error = NULL, updated_at = ?5 WHERE id = ?6",
            params![output, verdict.as_str(), converged, PrReviewStatus::Ready.as_str(), now(), id],
        )
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
    /// again. For consensus reviews this also discards the recorded round
    /// outputs and resets the round/convergence progress.
    pub fn reset_pr_review_for_rerun(&self, id: i64) -> Result<PrReview, String> {
        self.conn
            .execute(
                "DELETE FROM pr_review_runs WHERE pr_review_id = ?1",
                params![id],
            )
            .map_err(|error| format!("Failed to clear review rounds: {error}"))?;
        self.execute_pr_review_update(
            "UPDATE pr_reviews SET status = ?1, review_output = NULL, verdict = NULL, last_error = NULL, rounds_completed = 0, converged = NULL, updated_at = ?2 WHERE id = ?3",
            params![PrReviewStatus::Queued.as_str(), now(), id],
        )?;
        let review = self
            .pr_review_by_id(id)?
            .ok_or_else(|| "PR review not found".to_string())?;
        // A consensus rerun starts the convergence matrix over while keeping the
        // reviewer roster and round budget.
        if let Some(mut consensus) = review.consensus.clone() {
            consensus.rounds.clear();
            consensus.converged = false;
            consensus.converged_in_rounds = None;
            self.set_pr_review_consensus(id, &consensus)?;
            return self
                .pr_review_by_id(id)?
                .ok_or_else(|| "PR review not found".to_string());
        }
        Ok(review)
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
