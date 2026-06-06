use super::rows::{rows, task_from_row};
use super::{generated_branch_name, now, Database};
use crate::git_ops;
use crate::models::{TaskStatus, TaskSummary};
use rusqlite::{params, OptionalExtension};
use std::path::{Path, PathBuf};

impl Database {
    pub fn create_task_record(
        &self,
        repo_id: i64,
        title: String,
        prompt: Option<String>,
        agent_profile_id: Option<i64>,
        has_worktree: bool,
        branch_name: Option<String>,
    ) -> Result<TaskSummary, String> {
        let repo = self
            .repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;

        let (branch_name, worktree_path) = if has_worktree {
            let branch_name = branch_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(generated_branch_name);
            git_ops::validate_branch_name(&branch_name)?;
            let worktree_path = PathBuf::from(&repo.default_worktree_root).join(&branch_name);
            git_ops::create_worktree(
                PathBuf::from(&repo.path).as_path(),
                &worktree_path,
                &branch_name,
            )?;
            (Some(branch_name), Some(worktree_path))
        } else {
            (None, None)
        };

        let now = now();
        let worktree_path_value = worktree_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let insert = self.conn.execute(
            "
                INSERT INTO tasks
                  (repo_id, title, prompt, status, pr_url, agent_profile_id, active_session_id, last_session_id, last_session_agent, last_session_cwd, last_session_label, has_worktree, branch_name, worktree_path, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
                ",
            params![
                repo_id,
                title,
                prompt,
                TaskStatus::Planned.as_str(),
                None::<String>,
                agent_profile_id,
                None::<String>,
                None::<String>,
                None::<String>,
                None::<String>,
                None::<String>,
                has_worktree,
                branch_name,
                worktree_path_value,
                now
            ],
        );

        if let Err(error) = insert {
            // The worktree is created on disk before this INSERT, so a failure
            // here (e.g. a re-used branch tripping the unique index) would leave
            // an untracked worktree that delete_task can't see and that blocks
            // every retry with "Worktree path already exists". Compensate by
            // removing it — it is a freshly created, app-owned worktree, so the
            // force removal discards no user work.
            if let Some(path) = &worktree_path {
                let _ = git_ops::remove_worktree(PathBuf::from(&repo.path).as_path(), path, true);
            }
            return Err(format!("Failed to save task: {error}"));
        }

        self.task_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
    }

    pub fn list_tasks(&self, repo_id: Option<i64>) -> Result<Vec<TaskSummary>, String> {
        let sql = "
            SELECT t.id, t.repo_id, t.title, t.prompt, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
                   t.has_worktree, t.branch_name, t.worktree_path, t.active_session_id,
                   t.last_session_id, t.last_session_agent, t.last_session_cwd, t.last_session_label,
                   t.created_at, t.updated_at,
                   rl.status,
                   t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url
            FROM tasks t
            LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
            LEFT JOIN review_loops rl ON rl.task_id = t.id
        ";

        // A pure DB read: worktree dirtiness (a `git status` subprocess per task)
        // is intentionally NOT computed here. It is filled in off the DB lock at
        // the command layer (`list_tasks`) so a board load doesn't serialize N
        // git subprocesses inside the global mutex.
        if let Some(repo_id) = repo_id {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "{sql} WHERE t.repo_id = ?1 ORDER BY t.updated_at DESC"
                ))
                .map_err(|error| error.to_string())?;
            let result = rows(stmt
                .query_map(params![repo_id], task_from_row)
                .map_err(|error| error.to_string())?);
            result
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!("{sql} ORDER BY t.updated_at DESC"))
                .map_err(|error| error.to_string())?;
            let result = rows(stmt
                .query_map([], task_from_row)
                .map_err(|error| error.to_string())?);
            result
        }
    }

    pub fn task_by_id(&self, id: i64) -> Result<Option<TaskSummary>, String> {
        let row = self
            .conn
            .query_row(
                "
                SELECT t.id, t.repo_id, t.title, t.prompt, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
                       t.has_worktree, t.branch_name, t.worktree_path, t.active_session_id,
                       t.last_session_id, t.last_session_agent, t.last_session_cwd, t.last_session_label,
                       t.created_at, t.updated_at,
                       rl.status,
                       t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url
                FROM tasks t
                LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
                LEFT JOIN review_loops rl ON rl.task_id = t.id
                WHERE t.id = ?1
                ",
                params![id],
                task_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(row.map(|mut task| {
            task.is_dirty = task
                .worktree_path
                .as_ref()
                .is_some_and(|path| git_ops::is_dirty(PathBuf::from(path).as_path()));
            task
        }))
    }

    pub fn update_task_metadata(
        &self,
        task_id: i64,
        title: Option<String>,
        status: Option<TaskStatus>,
        pr_url: Option<String>,
    ) -> Result<TaskSummary, String> {
        let existing = self
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        let title = title.unwrap_or(existing.title);
        let status = status.unwrap_or(existing.status);
        let pr_url = pr_url.or(existing.pr_url);
        let updated_at = now();

        self.conn
            .execute(
                "
                UPDATE tasks
                SET title = ?1, status = ?2, pr_url = ?3, updated_at = ?4
                WHERE id = ?5
                ",
                params![title, status.as_str(), pr_url, updated_at, task_id],
            )
            .map_err(|error| format!("Failed to update task: {error}"))?;

        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found after update".into())
    }

    /// Set (or clear, when all fields are `None`) the local JIRA story link on a
    /// task. Attaching never writes back to JIRA — this only updates local state.
    pub fn set_task_jira_link(
        &self,
        task_id: i64,
        key: Option<String>,
        summary: Option<String>,
        url: Option<String>,
    ) -> Result<TaskSummary, String> {
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        self.conn
            .execute(
                "
                UPDATE tasks
                SET jira_issue_key = ?1, jira_issue_summary = ?2, jira_issue_url = ?3, updated_at = ?4
                WHERE id = ?5
                ",
                params![key, summary, url, now(), task_id],
            )
            .map_err(|error| format!("Failed to update JIRA link: {error}"))?;
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found after update".into())
    }

    /// Delete a task and, for worktree-backed tasks, remove its worktree. With
    /// `force`, a worktree carrying uncommitted work is discarded; without it,
    /// such a worktree is preserved and an error is returned so the caller can
    /// confirm before destroying user work (see [`git_ops::remove_worktree`]).
    pub fn delete_task(&self, task_id: i64, force: bool) -> Result<(), String> {
        let existing = self
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        if existing.active_session_id.is_some() {
            return Err("Stop the running session before deleting this task".into());
        }

        if let Some(worktree_path) = existing.worktree_path {
            let repo = self
                .repo_by_id(existing.repo_id)?
                .ok_or_else(|| "Repository not found".to_string())?;
            git_ops::remove_worktree(
                PathBuf::from(&repo.path).as_path(),
                Path::new(&worktree_path),
                force,
            )?;
        }

        self.conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
            .map_err(|error| format!("Failed to delete task: {error}"))?;
        Ok(())
    }
}
