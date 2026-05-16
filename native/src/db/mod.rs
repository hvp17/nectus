use crate::git_ops;
#[cfg(test)]
use crate::models::{
    AgentKind, AgentProfileInput, DensityMode, ReviewLoopStatus, ReviewRunInput, ReviewVerdict,
    ThemeMode,
};
use crate::models::{AppSettings, AppSettingsInput, Repo, TaskStatus, TaskSummary};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
#[cfg(test)]
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod agent_profiles;
mod migrations;
mod review_loops;
mod rows;

use rows::{app_settings_from_row, repo_from_row, rows, task_from_row};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app data folder: {error}"))?;
        }

        let conn =
            Connection::open(path).map_err(|error| format!("Failed to open database: {error}"))?;
        let db = Self { conn };
        db.migrate()?;
        db.seed_agent_profiles()?;
        db.seed_app_settings()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let db = Self {
            conn: Connection::open_in_memory().map_err(|error| error.to_string())?,
        };
        db.migrate()?;
        db.seed_agent_profiles()?;
        db.seed_app_settings()?;
        Ok(db)
    }

    pub fn add_repo(&self, path: String) -> Result<Repo, String> {
        let repo_path = std::fs::canonicalize(&path)
            .map_err(|error| format!("Failed to resolve repository path: {error}"))?;
        git_ops::validate_repo_path(&repo_path)?;
        let name = repo_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Repository")
            .to_string();
        let settings = self.get_app_settings()?;
        let default_root = git_ops::default_worktree_root_with_pattern(
            &repo_path,
            &settings.default_worktree_root_pattern,
        )
        .to_string_lossy()
        .to_string();
        let created_at = now();

        self.conn
            .execute(
                "
                INSERT INTO repos (name, path, default_worktree_root, created_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(path) DO UPDATE SET
                  name = excluded.name,
                  default_worktree_root = excluded.default_worktree_root
                ",
                params![name, repo_path.to_string_lossy(), default_root, created_at],
            )
            .map_err(|error| format!("Failed to save repository: {error}"))?;

        self.repo_by_path(&repo_path.to_string_lossy())?
            .ok_or_else(|| "Repository was saved but could not be loaded".into())
    }

    pub fn list_repos(&self) -> Result<Vec<Repo>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, path, default_worktree_root, created_at FROM repos ORDER BY name",
            )
            .map_err(|error| error.to_string())?;
        let result = rows(
            stmt.query_map([], repo_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    pub fn get_app_settings(&self) -> Result<AppSettings, String> {
        self.conn
            .query_row(
                "
                SELECT default_agent_profile_id, default_worktree_root_pattern, default_branch_prefix, theme, density, updated_at
                FROM app_settings
                WHERE id = 1
                ",
                [],
                app_settings_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?
            .transpose()?
            .ok_or_else(|| "App settings were not initialized".to_string())
    }

    pub fn update_app_settings(&self, settings: AppSettingsInput) -> Result<AppSettings, String> {
        if settings.default_worktree_root_pattern.trim().is_empty() {
            return Err("Worktree root pattern is required".into());
        }
        if !settings
            .default_worktree_root_pattern
            .contains("{repoName}")
        {
            return Err("Worktree root pattern must include {repoName}".into());
        }
        if let Some(profile_id) = settings.default_agent_profile_id {
            self.agent_profile_by_id(profile_id)?
                .ok_or_else(|| "Default agent profile not found".to_string())?;
        }

        let default_branch_prefix = settings
            .default_branch_prefix
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let pattern = settings.default_worktree_root_pattern.trim().to_string();
        let updated_at = now();
        self.conn
            .execute(
                "
                UPDATE app_settings
                SET default_agent_profile_id = ?1,
                    default_worktree_root_pattern = ?2,
                    default_branch_prefix = ?3,
                    theme = ?4,
                    density = ?5,
                    updated_at = ?6
                WHERE id = 1
                ",
                params![
                    settings.default_agent_profile_id,
                    pattern,
                    default_branch_prefix,
                    settings.theme.as_str(),
                    settings.density.as_str(),
                    updated_at
                ],
            )
            .map_err(|error| format!("Failed to update app settings: {error}"))?;
        self.refresh_repo_worktree_roots(&pattern)?;
        self.get_app_settings()
    }

    pub fn repo_by_id(&self, id: i64) -> Result<Option<Repo>, String> {
        self.conn
            .query_row(
                "SELECT id, name, path, default_worktree_root, created_at FROM repos WHERE id = ?1",
                params![id],
                repo_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn repo_by_path(&self, path: &str) -> Result<Option<Repo>, String> {
        self.conn
            .query_row(
                "SELECT id, name, path, default_worktree_root, created_at FROM repos WHERE path = ?1",
                params![path],
                repo_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

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
                .ok_or_else(|| "Branch name is required".to_string())?;
            git_ops::validate_branch_name(&branch_name)?;
            let worktree_path = PathBuf::from(&repo.default_worktree_root).join(&branch_name);
            git_ops::create_worktree(
                PathBuf::from(&repo.path).as_path(),
                &worktree_path,
                &branch_name,
            )?;
            (
                Some(branch_name),
                Some(worktree_path.to_string_lossy().to_string()),
            )
        } else {
            (None, None)
        };

        let now = now();
        self.conn
            .execute(
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
                    worktree_path,
                    now
                ],
            )
            .map_err(|error| format!("Failed to save task: {error}"))?;

        self.task_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
    }

    pub fn list_tasks(&self, repo_id: Option<i64>) -> Result<Vec<TaskSummary>, String> {
        let sql = "
            SELECT t.id, t.repo_id, t.title, t.prompt, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
                   t.has_worktree, t.branch_name, t.worktree_path, t.active_session_id,
                   t.last_session_id, t.last_session_agent, t.last_session_cwd, t.last_session_label,
                   t.created_at, t.updated_at
            FROM tasks t
            LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
        ";

        if let Some(repo_id) = repo_id {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "{sql} WHERE t.repo_id = ?1 ORDER BY t.updated_at DESC"
                ))
                .map_err(|error| error.to_string())?;
            let result = self.task_rows(
                stmt.query_map(params![repo_id], task_from_row)
                    .map_err(|error| error.to_string())?,
            );
            result
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!("{sql} ORDER BY t.updated_at DESC"))
                .map_err(|error| error.to_string())?;
            let result = self.task_rows(
                stmt.query_map([], task_from_row)
                    .map_err(|error| error.to_string())?,
            );
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
                       t.created_at, t.updated_at
                FROM tasks t
                LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
                WHERE t.id = ?1
                ",
                params![id],
                task_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let row = row.transpose()?;
        Ok(row.map(|mut task| {
            task.is_dirty = task
                .worktree_path
                .as_ref()
                .is_some_and(|path| git_ops::is_dirty(PathBuf::from(path).as_path()));
            task
        }))
    }

    fn task_rows<I>(&self, mapped: I) -> Result<Vec<TaskSummary>, String>
    where
        I: Iterator<Item = rusqlite::Result<Result<TaskSummary, String>>>,
    {
        mapped
            .map(|row| {
                let mut task = row.map_err(|error| error.to_string())??;
                task.is_dirty = task
                    .worktree_path
                    .as_ref()
                    .is_some_and(|path| git_ops::is_dirty(PathBuf::from(path).as_path()));
                Ok(task)
            })
            .collect()
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

    pub fn delete_task(&self, task_id: i64) -> Result<(), String> {
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
            )?;
        }

        self.conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
            .map_err(|error| format!("Failed to delete task: {error}"))?;
        Ok(())
    }

    pub fn set_active_session(&self, task_id: i64, session_id: Option<&str>) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![session_id, now(), task_id],
            )
            .map_err(|error| format!("Failed to update active session: {error}"))?;
        Ok(())
    }

    pub fn start_session_record(
        &self,
        task_id: i64,
        session_id: &str,
        agent: &str,
        cwd: &str,
        label: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "
                UPDATE tasks
                SET active_session_id = ?1,
                    last_session_id = ?1,
                    last_session_agent = ?2,
                    last_session_cwd = ?3,
                    last_session_label = ?4,
                    updated_at = ?5
                WHERE id = ?6
                ",
                params![session_id, agent, cwd, label, now(), task_id],
            )
            .map_err(|error| format!("Failed to update session state: {error}"))?;
        Ok(())
    }

    pub fn set_last_session(
        &self,
        task_id: i64,
        session_id: &str,
        label: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET last_session_id = ?1, last_session_label = ?2, updated_at = ?3 WHERE id = ?4",
                params![session_id, label, now(), task_id],
            )
            .map_err(|error| format!("Failed to update saved session: {error}"))?;
        Ok(())
    }

    pub fn clear_active_sessions(&self) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = NULL, updated_at = ?1 WHERE active_session_id IS NOT NULL",
                params![now()],
            )
            .map_err(|error| format!("Failed to clear stale active sessions: {error}"))?;
        Ok(())
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests;
