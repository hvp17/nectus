use super::rows::{review_loop_from_row, review_run_from_row, rows};
use super::{now, Database};
use crate::models::{
    ReviewLoop, ReviewLoopStatus, ReviewRun, ReviewRunInput, ReviewVerdict, TaskStatus,
};
use rusqlite::{params, OptionalExtension};

impl Database {
    pub fn start_review_loop(
        &self,
        task_id: i64,
        reviewer_profile_id: i64,
    ) -> Result<ReviewLoop, String> {
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        self.agent_profile_by_id(reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;

        let now = now();
        self.conn
            .execute(
                "
                INSERT INTO review_loops
                  (task_id, reviewer_profile_id, status, last_error, created_at, updated_at)
                VALUES (?1, ?2, ?3, NULL, ?4, ?4)
                ON CONFLICT(task_id) DO UPDATE SET
                  reviewer_profile_id = excluded.reviewer_profile_id,
                  status = excluded.status,
                  last_error = NULL,
                  updated_at = excluded.updated_at
                ",
                params![
                    task_id,
                    reviewer_profile_id,
                    ReviewLoopStatus::Running.as_str(),
                    now
                ],
            )
            .map_err(|error| format!("Failed to start review loop: {error}"))?;

        self.review_loop_by_task_id(task_id)?
            .ok_or_else(|| "Review loop was saved but could not be loaded".to_string())
    }

    pub fn stop_review_loop(&self, task_id: i64) -> Result<ReviewLoop, String> {
        self.set_review_loop_state(task_id, ReviewLoopStatus::Stopped, None)?;
        self.review_loop_by_task_id(task_id)?
            .ok_or_else(|| "Review loop not found".to_string())
    }

    pub fn review_loop_by_task_id(&self, task_id: i64) -> Result<Option<ReviewLoop>, String> {
        self.conn
            .query_row(
                "
                SELECT task_id, reviewer_profile_id, status, last_error, created_at, updated_at
                FROM review_loops
                WHERE task_id = ?1
                ",
                params![task_id],
                review_loop_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn list_review_runs(&self, task_id: i64) -> Result<Vec<ReviewRun>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT id, task_id, reviewer_profile_id, verdict, prompt, output, error, created_at
                FROM review_runs
                WHERE task_id = ?1
                ORDER BY id ASC
                ",
            )
            .map_err(|error| error.to_string())?;

        let result = rows(
            stmt.query_map(params![task_id], review_run_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    pub fn record_review_run(&self, input: ReviewRunInput) -> Result<ReviewRun, String> {
        self.review_loop_by_task_id(input.task_id)?
            .ok_or_else(|| "Review loop not found".to_string())?;
        self.agent_profile_by_id(input.reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;

        // Record the run, transition the loop state, and (on Pass) flip the task
        // to Done atomically, so a failure partway can't leave a recorded run
        // whose loop/task state never updated.
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("Failed to record review run: {error}"))?;
        let created_at = now();
        self.conn
            .execute(
                "
                INSERT INTO review_runs
                  (task_id, reviewer_profile_id, verdict, prompt, output, error, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    input.task_id,
                    input.reviewer_profile_id,
                    input.verdict.as_str(),
                    input.prompt,
                    input.output,
                    input.error,
                    created_at
                ],
            )
            .map_err(|error| format!("Failed to record review run: {error}"))?;

        let run = self
            .review_run_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "Review run was saved but could not be loaded".to_string())?;
        let (status, last_error) = review_loop_state_after_run(&run);
        self.set_review_loop_state(input.task_id, status, last_error.as_deref())?;
        if run.verdict == ReviewVerdict::Pass {
            self.update_task_metadata(input.task_id, None, Some(TaskStatus::Done), None)?;
        }
        tx.commit()
            .map_err(|error| format!("Failed to record review run: {error}"))?;
        Ok(run)
    }

    pub fn set_review_loop_state(
        &self,
        task_id: i64,
        status: ReviewLoopStatus,
        last_error: Option<&str>,
    ) -> Result<(), String> {
        let changed = self
            .conn
            .execute(
                "
                UPDATE review_loops
                SET status = ?1,
                    last_error = ?2,
                    updated_at = ?3
                WHERE task_id = ?4
                ",
                params![status.as_str(), last_error, now(), task_id],
            )
            .map_err(|error| format!("Failed to update review loop: {error}"))?;
        if changed == 0 {
            return Err("Review loop not found".to_string());
        }
        Ok(())
    }

    fn review_run_by_id(&self, id: i64) -> Result<Option<ReviewRun>, String> {
        self.conn
            .query_row(
                "
                SELECT id, task_id, reviewer_profile_id, verdict, prompt, output, error, created_at
                FROM review_runs
                WHERE id = ?1
                ",
                params![id],
                review_run_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }
}

fn review_loop_state_after_run(run: &ReviewRun) -> (ReviewLoopStatus, Option<String>) {
    match run.verdict {
        ReviewVerdict::Pass => (ReviewLoopStatus::Passed, None),
        ReviewVerdict::NeedsChanges | ReviewVerdict::Feedback => {
            (ReviewLoopStatus::FeedbackSent, None)
        }
        ReviewVerdict::Unknown => {
            (
                ReviewLoopStatus::Error,
                Some(run.error.clone().unwrap_or_else(|| {
                    "Reviewer output did not include a clear verdict".to_string()
                })),
            )
        }
    }
}
