use crate::git_ops;
use crate::models::{
    AgentKind, AgentProfile, AgentProfileInput, AppSettings, AppSettingsInput, DensityMode, Repo,
    TaskStatus, TaskSummary, ThemeMode,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS repos (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  path TEXT NOT NULL UNIQUE,
                  default_worktree_root TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agent_profiles (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE,
                  agent_kind TEXT NOT NULL DEFAULT 'custom',
                  command TEXT NOT NULL,
                  model TEXT,
                  args_json TEXT NOT NULL,
                  env_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  default_agent_profile_id INTEGER REFERENCES agent_profiles(id) ON DELETE SET NULL,
                  default_worktree_root_pattern TEXT NOT NULL,
                  default_branch_prefix TEXT,
                  theme TEXT NOT NULL,
                  density TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  status TEXT NOT NULL,
                  pr_url TEXT,
                  agent_profile_id INTEGER REFERENCES agent_profiles(id),
                  active_session_id TEXT,
                  last_session_id TEXT,
                  last_session_agent TEXT,
                  last_session_cwd TEXT,
                  last_session_label TEXT,
                  has_worktree INTEGER NOT NULL DEFAULT 0,
                  branch_name TEXT,
                  worktree_path TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  CHECK (
                    (has_worktree = 0 AND branch_name IS NULL AND worktree_path IS NULL)
                    OR
                    (has_worktree = 1 AND branch_name IS NOT NULL AND worktree_path IS NOT NULL)
                  )
                );

                CREATE UNIQUE INDEX IF NOT EXISTS tasks_worktree_path_unique
                ON tasks(worktree_path)
                WHERE has_worktree = 1;

                CREATE UNIQUE INDEX IF NOT EXISTS tasks_repo_branch_unique
                ON tasks(repo_id, branch_name)
                WHERE has_worktree = 1;
                ",
            )
            .map_err(|error| format!("Failed to migrate database: {error}"))?;

        self.add_missing_column("tasks", "last_session_id", "TEXT")?;
        self.add_missing_column("tasks", "last_session_agent", "TEXT")?;
        self.add_missing_column("tasks", "last_session_cwd", "TEXT")?;
        self.add_missing_column("tasks", "last_session_label", "TEXT")?;
        self.add_missing_column(
            "agent_profiles",
            "agent_kind",
            "TEXT NOT NULL DEFAULT 'custom'",
        )?;
        self.add_missing_column("agent_profiles", "model", "TEXT")?;
        self.migrate_legacy_worktrees()
    }

    fn add_missing_column(
        &self,
        table: &str,
        column: &str,
        column_type: &str,
    ) -> Result<(), String> {
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("Failed to inspect {table} table: {error}"))?;
        let columns = rows(
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| format!("Failed to inspect {table} columns: {error}"))?,
        )?;
        if columns.iter().any(|name| name == column) {
            return Ok(());
        }

        self.conn
            .execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
                [],
            )
            .map_err(|error| format!("Failed to add {column} column: {error}"))?;
        Ok(())
    }

    fn migrate_legacy_worktrees(&self) -> Result<(), String> {
        let has_worktrees_table: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worktrees')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("Failed to inspect legacy worktrees table: {error}"))?;
        if !has_worktrees_table {
            return Ok(());
        }

        let task_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .map_err(|error| format!("Failed to inspect tasks table: {error}"))?;
        if task_count > 0 {
            return Ok(());
        }

        let mut columns = self
            .conn
            .prepare("PRAGMA table_info(worktrees)")
            .map_err(|error| format!("Failed to inspect worktrees table: {error}"))?;
        let column_names = rows(
            columns
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| format!("Failed to inspect worktrees columns: {error}"))?,
        )?;
        let has_worktree_expr = if column_names.iter().any(|name| name == "has_worktree") {
            "has_worktree"
        } else {
            "1"
        };

        self.conn
            .execute_batch(&format!(
                "
                INSERT INTO tasks
                  (id, repo_id, title, status, pr_url, agent_profile_id, active_session_id, last_session_id, last_session_agent, last_session_cwd, last_session_label,
                   has_worktree, branch_name, worktree_path, created_at, updated_at)
                SELECT id, repo_id, task_title, status, pr_url, agent_profile_id, active_session_id, active_session_id, NULL, NULL, NULL,
                       {has_worktree_expr},
                       CASE WHEN {has_worktree_expr} = 1 THEN branch_name ELSE NULL END,
                       CASE WHEN {has_worktree_expr} = 1 THEN path ELSE NULL END,
                       created_at, updated_at
                FROM worktrees;
                "
            ))
            .map_err(|error| format!("Failed to migrate legacy worktrees: {error}"))
    }

    fn seed_agent_profiles(&self) -> Result<(), String> {
        let now = now();
        for (name, kind, command) in [
            ("Codex", AgentKind::Codex, "codex"),
            ("Claude", AgentKind::Claude, "claude"),
            ("Gemini", AgentKind::Gemini, "gemini"),
        ] {
            self.conn
                .execute(
                    "
                    INSERT INTO agent_profiles (name, agent_kind, command, model, args_json, env_json, created_at, updated_at)
                    VALUES (?1, ?2, ?3, NULL, '[]', '{}', ?4, ?4)
                    ON CONFLICT(name) DO UPDATE SET
                      agent_kind = excluded.agent_kind,
                      updated_at = excluded.updated_at
                    ",
                    params![name, kind.as_str(), command, now],
                )
                .map_err(|error| format!("Failed to seed agent profiles: {error}"))?;
        }
        Ok(())
    }

    fn seed_app_settings(&self) -> Result<(), String> {
        let default_agent_profile_id = self
            .agent_profile_by_name("Codex")?
            .map(|profile| profile.id)
            .or_else(|| {
                self.list_agent_profiles()
                    .ok()?
                    .first()
                    .map(|profile| profile.id)
            });
        let now = now();

        self.conn
            .execute(
                "
                INSERT OR IGNORE INTO app_settings
                  (id, default_agent_profile_id, default_worktree_root_pattern, default_branch_prefix, theme, density, updated_at)
                VALUES (1, ?1, ?2, NULL, ?3, ?4, ?5)
                ",
                params![
                    default_agent_profile_id,
                    "../{repoName}-worktrees",
                    ThemeMode::System.as_str(),
                    DensityMode::Comfortable.as_str(),
                    now
                ],
            )
            .map_err(|error| format!("Failed to seed app settings: {error}"))?;
        Ok(())
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

    fn refresh_repo_worktree_roots(&self, pattern: &str) -> Result<(), String> {
        let repos = self.list_repos()?;
        for repo in repos {
            let repo_path = PathBuf::from(&repo.path);
            let default_root = git_ops::default_worktree_root_with_pattern(&repo_path, pattern)
                .to_string_lossy()
                .to_string();
            self.conn
                .execute(
                    "UPDATE repos SET default_worktree_root = ?1 WHERE id = ?2",
                    params![default_root, repo.id],
                )
                .map_err(|error| format!("Failed to refresh repository worktree root: {error}"))?;
        }
        Ok(())
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
                  (repo_id, title, status, pr_url, agent_profile_id, active_session_id, last_session_id, last_session_agent, last_session_cwd, last_session_label, has_worktree, branch_name, worktree_path, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
                ",
                params![
                    repo_id,
                    title,
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
            SELECT t.id, t.repo_id, t.title, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
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
                SELECT t.id, t.repo_id, t.title, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
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

    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfile>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles ORDER BY id")
            .map_err(|error| error.to_string())?;
        let result = rows(
            stmt.query_map([], agent_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    pub fn agent_profile_by_id(&self, id: i64) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE id = ?1",
                params![id],
                agent_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn upsert_agent_profile(&self, profile: AgentProfileInput) -> Result<AgentProfile, String> {
        if profile.name.trim().is_empty() {
            return Err("Agent profile name is required".into());
        }
        if profile.command.trim().is_empty() {
            return Err("Agent command is required".into());
        }

        let now = now();
        let model = profile
            .model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_json = serde_json::to_string(&profile.args).map_err(|error| error.to_string())?;
        let env_json = serde_json::to_string(&profile.env).map_err(|error| error.to_string())?;

        if let Some(id) = profile.id {
            self.conn
                .execute(
                    "
                    UPDATE agent_profiles
                    SET name = ?1, agent_kind = ?2, command = ?3, model = ?4, args_json = ?5, env_json = ?6, updated_at = ?7
                    WHERE id = ?8
                    ",
                    params![
                        profile.name,
                        profile.agent_kind.as_str(),
                        profile.command,
                        model,
                        args_json,
                        env_json,
                        now,
                        id
                    ],
                )
                .map_err(|error| format!("Failed to update agent profile: {error}"))?;
            self.agent_profile_by_id(id)?
                .ok_or_else(|| "Agent profile not found after update".into())
        } else {
            self.conn
                .execute(
                    "
                    INSERT INTO agent_profiles (name, agent_kind, command, model, args_json, env_json, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                    ON CONFLICT(name) DO UPDATE SET
                      agent_kind = excluded.agent_kind,
                      command = excluded.command,
                      model = excluded.model,
                      args_json = excluded.args_json,
                      env_json = excluded.env_json,
                      updated_at = excluded.updated_at
                    ",
                    params![
                        profile.name,
                        profile.agent_kind.as_str(),
                        profile.command,
                        model,
                        args_json,
                        env_json,
                        now
                    ],
                )
                .map_err(|error| format!("Failed to save agent profile: {error}"))?;

            self.agent_profile_by_name(&profile.name)?
                .ok_or_else(|| "Agent profile not found after save".into())
        }
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

    fn agent_profile_by_name(&self, name: &str) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE name = ?1",
                params![name],
                agent_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn rows<T, I>(mapped: I) -> Result<Vec<T>, String>
where
    I: Iterator<Item = rusqlite::Result<T>>,
{
    mapped
        .map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

fn repo_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Repo> {
    Ok(Repo {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        default_worktree_root: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<TaskSummary, String>> {
    let status: String = row.get(3)?;
    let status = match TaskStatus::from_str(&status) {
        Ok(status) => status,
        Err(error) => return Ok(Err(error)),
    };
    let agent_kind: Option<String> = row.get(7)?;
    let agent_kind = match agent_kind.as_deref().map(AgentKind::from_str).transpose() {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    Ok(Ok(TaskSummary {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        title: row.get(2)?,
        status,
        pr_url: row.get(4)?,
        agent_profile_id: row.get(5)?,
        agent_name: row.get(6)?,
        agent_kind,
        has_worktree: row.get(8)?,
        branch_name: row.get(9)?,
        worktree_path: row.get(10)?,
        is_dirty: false,
        active_session_id: row.get(11)?,
        last_session_id: row.get(12)?,
        last_session_agent: row.get(13)?,
        last_session_cwd: row.get(14)?,
        last_session_label: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    }))
}

fn agent_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentProfile> {
    let agent_kind: String = row.get(2)?;
    let agent_kind = match AgentKind::from_str(&agent_kind) {
        Ok(kind) => kind,
        Err(error) => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            ));
        }
    };
    let args_json: String = row.get(5)?;
    let env_json: String = row.get(6)?;
    Ok(AgentProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_kind,
        command: row.get(3)?,
        model: row.get(4)?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        env: serde_json::from_str::<BTreeMap<String, String>>(&env_json).unwrap_or_default(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn app_settings_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<AppSettings, String>> {
    let theme: String = row.get(3)?;
    let density: String = row.get(4)?;
    let theme = match ThemeMode::from_str(&theme) {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    let density = match DensityMode::from_str(&density) {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };

    Ok(Ok(AppSettings {
        default_agent_profile_id: row.get(0)?,
        default_worktree_root_pattern: row.get(1)?,
        default_branch_prefix: row.get(2)?,
        theme,
        density,
        updated_at: row.get(5)?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn seeds_default_agent_profiles() {
        let db = Database::open_in_memory().unwrap();
        let profiles = db.list_agent_profiles().unwrap();

        assert_eq!(profiles.len(), 3);
        assert_eq!(profiles[0].command, "codex");
        assert_eq!(profiles[1].command, "claude");
        assert_eq!(profiles[2].command, "gemini");
        assert_eq!(profiles[0].agent_kind, AgentKind::Codex);
        assert_eq!(profiles[1].agent_kind, AgentKind::Claude);
        assert_eq!(profiles[2].agent_kind, AgentKind::Gemini);
    }

    #[test]
    fn seeds_and_updates_global_app_settings() {
        let db = Database::open_in_memory().unwrap();
        let profiles = db.list_agent_profiles().unwrap();

        let settings = db.get_app_settings().unwrap();
        assert_eq!(
            settings.default_agent_profile_id,
            profiles.first().map(|profile| profile.id)
        );
        assert_eq!(
            settings.default_worktree_root_pattern,
            "../{repoName}-worktrees"
        );
        assert_eq!(settings.default_branch_prefix, None);
        assert_eq!(settings.theme, ThemeMode::System);
        assert_eq!(settings.density, DensityMode::Comfortable);

        let updated = db
            .update_app_settings(AppSettingsInput {
                default_agent_profile_id: Some(profiles[1].id),
                default_worktree_root_pattern: "../worktrees/{repoName}".to_string(),
                default_branch_prefix: Some("feat/".to_string()),
                theme: ThemeMode::Dark,
                density: DensityMode::Compact,
            })
            .unwrap();

        assert_eq!(updated.default_agent_profile_id, Some(profiles[1].id));
        assert_eq!(
            updated.default_worktree_root_pattern,
            "../worktrees/{repoName}"
        );
        assert_eq!(updated.default_branch_prefix.as_deref(), Some("feat/"));
        assert_eq!(updated.theme, ThemeMode::Dark);
        assert_eq!(updated.density, DensityMode::Compact);
    }

    #[test]
    fn updated_worktree_root_pattern_applies_to_existing_and_new_repos() {
        let db = Database::open_in_memory().unwrap();
        let first_repo_dir = tempdir().unwrap();
        let second_repo_dir = tempdir().unwrap();
        for repo_dir in [&first_repo_dir, &second_repo_dir] {
            std::process::Command::new("git")
                .arg("init")
                .arg(repo_dir.path())
                .output()
                .unwrap();
        }
        let first = db
            .add_repo(first_repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let first_repo_name = first_repo_dir.path().file_name().unwrap().to_str().unwrap();

        db.update_app_settings(AppSettingsInput {
            default_agent_profile_id: None,
            default_worktree_root_pattern: "../global-worktrees/{repoName}".to_string(),
            default_branch_prefix: None,
            theme: ThemeMode::System,
            density: DensityMode::Comfortable,
        })
        .unwrap();

        let refreshed_first = db.repo_by_id(first.id).unwrap().unwrap();
        assert!(refreshed_first
            .default_worktree_root
            .ends_with(&format!("global-worktrees/{first_repo_name}")));

        let second = db
            .add_repo(second_repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let second_repo_name = second_repo_dir
            .path()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(second
            .default_worktree_root
            .ends_with(&format!("global-worktrees/{second_repo_name}")));
    }

    #[test]
    fn upserts_agent_profile_with_args_and_env() {
        let db = Database::open_in_memory().unwrap();
        let mut env = BTreeMap::new();
        env.insert("MODEL".to_string(), "fast".to_string());

        let profile = db
            .upsert_agent_profile(AgentProfileInput {
                id: None,
                name: "Custom".to_string(),
                agent_kind: AgentKind::Custom,
                command: "custom-agent".to_string(),
                model: Some("custom-fast".to_string()),
                args: vec!["--resume".to_string()],
                env,
            })
            .unwrap();

        assert_eq!(profile.name, "Custom");
        assert_eq!(profile.agent_kind, AgentKind::Custom);
        assert_eq!(profile.model.as_deref(), Some("custom-fast"));
        assert_eq!(profile.args, vec!["--resume"]);
        assert_eq!(profile.env.get("MODEL").unwrap(), "fast");
    }

    #[test]
    fn creates_task_without_worktree() {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();

        let task = db
            .create_task_record(
                repo.id,
                "Review dependency updates".to_string(),
                None,
                false,
                None,
            )
            .unwrap();

        assert_eq!(task.repo_id, repo.id);
        assert_eq!(task.title, "Review dependency updates");
        assert!(!task.has_worktree);
        assert_eq!(task.branch_name, None);
        assert_eq!(task.worktree_path, None);
    }

    #[test]
    fn adding_existing_repo_returns_existing_repo() {
        let db = Database::open_in_memory().unwrap();
        let first_repo_dir = tempdir().unwrap();
        let second_repo_dir = tempdir().unwrap();
        for repo_dir in [&first_repo_dir, &second_repo_dir] {
            std::process::Command::new("git")
                .arg("init")
                .arg(repo_dir.path())
                .output()
                .unwrap();
        }

        let first = db
            .add_repo(first_repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let _second = db
            .add_repo(second_repo_dir.path().to_string_lossy().to_string())
            .unwrap();

        let duplicate = db
            .add_repo(first_repo_dir.path().to_string_lossy().to_string())
            .unwrap();

        assert_eq!(duplicate.id, first.id);
        assert_eq!(duplicate.path, first.path);
    }

    #[test]
    fn upserting_existing_agent_profile_returns_existing_profile() {
        let db = Database::open_in_memory().unwrap();
        let custom = db
            .upsert_agent_profile(AgentProfileInput {
                id: None,
                name: "Custom".to_string(),
                agent_kind: AgentKind::Custom,
                command: "custom-agent".to_string(),
                model: None,
                args: vec![],
                env: BTreeMap::new(),
            })
            .unwrap();

        let codex = db
            .upsert_agent_profile(AgentProfileInput {
                id: None,
                name: "Codex".to_string(),
                agent_kind: AgentKind::Codex,
                command: "codex-next".to_string(),
                model: Some("gpt-5.3-codex".to_string()),
                args: vec!["--fast".to_string()],
                env: BTreeMap::new(),
            })
            .unwrap();

        assert_ne!(codex.id, custom.id);
        assert_eq!(codex.name, "Codex");
        assert_eq!(codex.agent_kind, AgentKind::Codex);
        assert_eq!(codex.command, "codex-next");
        assert_eq!(codex.model.as_deref(), Some("gpt-5.3-codex"));
    }

    #[test]
    fn list_tasks_rejects_unknown_status() {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();

        db.conn
            .execute(
                "
                INSERT INTO tasks
                  (repo_id, title, status, has_worktree, created_at, updated_at)
                VALUES (?1, 'Bad status', 'archived', 0, 'now', 'now')
                ",
                params![repo.id],
            )
            .unwrap();

        let error = db.list_tasks(None).unwrap_err();

        assert!(error.contains("Unknown task status"), "{error}");
    }

    #[test]
    fn starting_and_stopping_session_preserves_last_session_snapshot() {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let task = db
            .create_task_record(
                repo.id,
                "Continue agent work".to_string(),
                None,
                false,
                None,
            )
            .unwrap();

        db.start_session_record(task.id, "session-123", "codex", "/tmp/worktree", None)
            .unwrap();
        let running = db.task_by_id(task.id).unwrap().unwrap();
        assert_eq!(running.active_session_id.as_deref(), Some("session-123"));
        assert_eq!(running.last_session_id.as_deref(), Some("session-123"));
        assert_eq!(running.last_session_agent.as_deref(), Some("codex"));
        assert_eq!(running.last_session_cwd.as_deref(), Some("/tmp/worktree"));
        assert_eq!(running.last_session_label, None);

        db.set_active_session(task.id, None).unwrap();
        let stopped = db.task_by_id(task.id).unwrap().unwrap();
        assert_eq!(stopped.active_session_id, None);
        assert_eq!(stopped.last_session_id.as_deref(), Some("session-123"));
        assert_eq!(stopped.last_session_agent.as_deref(), Some("codex"));
        assert_eq!(stopped.last_session_cwd.as_deref(), Some("/tmp/worktree"));

        db.set_last_session(task.id, "session-456", Some("Implement resume"))
            .unwrap();
        let refreshed = db.task_by_id(task.id).unwrap().unwrap();
        assert_eq!(refreshed.last_session_id.as_deref(), Some("session-456"));
        assert_eq!(
            refreshed.last_session_label.as_deref(),
            Some("Implement resume")
        );
    }

    #[test]
    fn deletes_task_without_active_session() {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let task = db
            .create_task_record(repo.id, "Remove stale task".to_string(), None, false, None)
            .unwrap();

        db.delete_task(task.id).unwrap();

        assert!(db.task_by_id(task.id).unwrap().is_none());
    }

    #[test]
    fn delete_task_rejects_active_session() {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let task = db
            .create_task_record(repo.id, "Running task".to_string(), None, false, None)
            .unwrap();
        db.start_session_record(
            task.id,
            "session-123",
            "codex",
            repo_dir.path().to_str().unwrap(),
            None,
        )
        .unwrap();

        let error = db.delete_task(task.id).unwrap_err();

        assert!(error.contains("Stop the running session"), "{error}");
        assert!(db.task_by_id(task.id).unwrap().is_some());
    }
}
