use crate::git_ops;
use crate::models::{AgentProfile, AgentProfileInput, Repo, WorktreeStatus, WorktreeSummary};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app data folder: {error}"))?;
        }

        let conn = Connection::open(path).map_err(|error| format!("Failed to open database: {error}"))?;
        let db = Self { conn };
        db.migrate()?;
        db.seed_agent_profiles()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let db = Self {
            conn: Connection::open_in_memory().map_err(|error| error.to_string())?,
        };
        db.migrate()?;
        db.seed_agent_profiles()?;
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
                  command TEXT NOT NULL,
                  args_json TEXT NOT NULL,
                  env_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS worktrees (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                  branch_name TEXT NOT NULL,
                  path TEXT NOT NULL UNIQUE,
                  task_title TEXT NOT NULL,
                  status TEXT NOT NULL,
                  pr_url TEXT,
                  agent_profile_id INTEGER REFERENCES agent_profiles(id),
                  active_session_id TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                ",
            )
            .map_err(|error| format!("Failed to migrate database: {error}"))
    }

    fn seed_agent_profiles(&self) -> Result<(), String> {
        let now = now();
        for (name, command) in [("Codex", "codex"), ("Claude", "claude")] {
            self.conn
                .execute(
                    "
                    INSERT OR IGNORE INTO agent_profiles (name, command, args_json, env_json, created_at, updated_at)
                    VALUES (?1, ?2, '[]', '{}', ?3, ?3)
                    ",
                    params![name, command, now],
                )
                .map_err(|error| format!("Failed to seed agent profiles: {error}"))?;
        }
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
        let default_root = git_ops::default_worktree_root(&repo_path).to_string_lossy().to_string();
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

        let id = self.conn.last_insert_rowid();
        if id == 0 {
            self.repo_by_path(&repo_path.to_string_lossy())?
                .ok_or_else(|| "Repository was saved but could not be loaded".into())
        } else {
            self.repo_by_id(id)?
                .ok_or_else(|| "Repository was saved but could not be loaded".into())
        }
    }

    pub fn list_repos(&self) -> Result<Vec<Repo>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, path, default_worktree_root, created_at FROM repos ORDER BY name")
            .map_err(|error| error.to_string())?;
        let result = rows(stmt.query_map([], repo_from_row).map_err(|error| error.to_string())?);
        result
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

    pub fn create_worktree_record(
        &self,
        repo_id: i64,
        branch_name: String,
        task_title: String,
        agent_profile_id: Option<i64>,
    ) -> Result<WorktreeSummary, String> {
        let repo = self
            .repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        git_ops::validate_branch_name(&branch_name)?;

        let worktree_path = PathBuf::from(&repo.default_worktree_root).join(&branch_name);
        git_ops::create_worktree(PathBuf::from(&repo.path).as_path(), &worktree_path, &branch_name)?;

        let now = now();
        self.conn
            .execute(
                "
                INSERT INTO worktrees
                  (repo_id, branch_name, path, task_title, status, pr_url, agent_profile_id, active_session_id, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, NULL, ?7, ?7)
                ",
                params![
                    repo_id,
                    branch_name,
                    worktree_path.to_string_lossy(),
                    task_title,
                    WorktreeStatus::Planned.as_str(),
                    agent_profile_id,
                    now
                ],
            )
            .map_err(|error| format!("Failed to save worktree: {error}"))?;

        self.worktree_by_id(self.conn.last_insert_rowid())?
            .ok_or_else(|| "Worktree was saved but could not be loaded".into())
    }

    pub fn list_worktrees(&self, repo_id: Option<i64>) -> Result<Vec<WorktreeSummary>, String> {
        let sql = "
            SELECT w.id, w.repo_id, w.branch_name, w.path, w.task_title, w.status, w.pr_url,
                   w.agent_profile_id, a.name, w.active_session_id, w.created_at, w.updated_at
            FROM worktrees w
            LEFT JOIN agent_profiles a ON a.id = w.agent_profile_id
        ";

        if let Some(repo_id) = repo_id {
            let mut stmt = self
                .conn
                .prepare(&format!("{sql} WHERE w.repo_id = ?1 ORDER BY w.updated_at DESC"))
                .map_err(|error| error.to_string())?;
            let result = self.worktree_rows(
                stmt.query_map(params![repo_id], worktree_from_row)
                    .map_err(|error| error.to_string())?,
            );
            result
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!("{sql} ORDER BY w.updated_at DESC"))
                .map_err(|error| error.to_string())?;
            let result = self.worktree_rows(stmt.query_map([], worktree_from_row).map_err(|error| error.to_string())?);
            result
        }
    }

    pub fn worktree_by_id(&self, id: i64) -> Result<Option<WorktreeSummary>, String> {
        let row = self
            .conn
            .query_row(
                "
                SELECT w.id, w.repo_id, w.branch_name, w.path, w.task_title, w.status, w.pr_url,
                       w.agent_profile_id, a.name, w.active_session_id, w.created_at, w.updated_at
                FROM worktrees w
                LEFT JOIN agent_profiles a ON a.id = w.agent_profile_id
                WHERE w.id = ?1
                ",
                params![id],
                worktree_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(row.map(|mut worktree| {
            worktree.is_dirty = git_ops::is_dirty(PathBuf::from(&worktree.path).as_path());
            worktree
        }))
    }

    fn worktree_rows<I>(&self, mapped: I) -> Result<Vec<WorktreeSummary>, String>
    where
        I: Iterator<Item = rusqlite::Result<WorktreeSummary>>,
    {
        mapped
            .map(|row| {
                let mut worktree = row.map_err(|error| error.to_string())?;
                worktree.is_dirty = git_ops::is_dirty(PathBuf::from(&worktree.path).as_path());
                Ok(worktree)
            })
            .collect()
    }

    pub fn update_worktree_metadata(
        &self,
        worktree_id: i64,
        task_title: Option<String>,
        status: Option<WorktreeStatus>,
        pr_url: Option<String>,
    ) -> Result<WorktreeSummary, String> {
        let existing = self
            .worktree_by_id(worktree_id)?
            .ok_or_else(|| "Worktree not found".to_string())?;
        let task_title = task_title.unwrap_or(existing.task_title);
        let status = status.unwrap_or(existing.status);
        let pr_url = pr_url.or(existing.pr_url);
        let updated_at = now();

        self.conn
            .execute(
                "
                UPDATE worktrees
                SET task_title = ?1, status = ?2, pr_url = ?3, updated_at = ?4
                WHERE id = ?5
                ",
                params![task_title, status.as_str(), pr_url, updated_at, worktree_id],
            )
            .map_err(|error| format!("Failed to update worktree: {error}"))?;

        self.worktree_by_id(worktree_id)?
            .ok_or_else(|| "Worktree not found after update".into())
    }

    pub fn set_active_session(&self, worktree_id: i64, session_id: Option<&str>) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE worktrees SET active_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![session_id, now(), worktree_id],
            )
            .map_err(|error| format!("Failed to update active session: {error}"))?;
        Ok(())
    }

    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfile>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, command, args_json, env_json, created_at, updated_at FROM agent_profiles ORDER BY id")
            .map_err(|error| error.to_string())?;
        let result = rows(stmt.query_map([], agent_from_row).map_err(|error| error.to_string())?);
        result
    }

    pub fn agent_profile_by_id(&self, id: i64) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, command, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE id = ?1",
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
        let args_json = serde_json::to_string(&profile.args).map_err(|error| error.to_string())?;
        let env_json = serde_json::to_string(&profile.env).map_err(|error| error.to_string())?;

        if let Some(id) = profile.id {
            self.conn
                .execute(
                    "
                    UPDATE agent_profiles
                    SET name = ?1, command = ?2, args_json = ?3, env_json = ?4, updated_at = ?5
                    WHERE id = ?6
                    ",
                    params![profile.name, profile.command, args_json, env_json, now, id],
                )
                .map_err(|error| format!("Failed to update agent profile: {error}"))?;
            self.agent_profile_by_id(id)?
                .ok_or_else(|| "Agent profile not found after update".into())
        } else {
            self.conn
                .execute(
                    "
                    INSERT INTO agent_profiles (name, command, args_json, env_json, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                    ON CONFLICT(name) DO UPDATE SET
                      command = excluded.command,
                      args_json = excluded.args_json,
                      env_json = excluded.env_json,
                      updated_at = excluded.updated_at
                    ",
                    params![profile.name, profile.command, args_json, env_json, now],
                )
                .map_err(|error| format!("Failed to save agent profile: {error}"))?;

            let id = self.conn.last_insert_rowid();
            if id == 0 {
                self.agent_profile_by_name(&profile.name)?
                    .ok_or_else(|| "Agent profile not found after save".into())
            } else {
                self.agent_profile_by_id(id)?
                    .ok_or_else(|| "Agent profile not found after save".into())
            }
        }
    }

    fn agent_profile_by_name(&self, name: &str) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, command, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE name = ?1",
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
    mapped.map(|row| row.map_err(|error| error.to_string())).collect()
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

fn worktree_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorktreeSummary> {
    let status: String = row.get(5)?;
    Ok(WorktreeSummary {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        branch_name: row.get(2)?,
        path: row.get(3)?,
        task_title: row.get(4)?,
        status: WorktreeStatus::from_str(&status),
        pr_url: row.get(6)?,
        agent_profile_id: row.get(7)?,
        agent_name: row.get(8)?,
        is_dirty: false,
        active_session_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn agent_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentProfile> {
    let args_json: String = row.get(3)?;
    let env_json: String = row.get(4)?;
    Ok(AgentProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        command: row.get(2)?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        env: serde_json::from_str::<BTreeMap<String, String>>(&env_json).unwrap_or_default(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_default_agent_profiles() {
        let db = Database::open_in_memory().unwrap();
        let profiles = db.list_agent_profiles().unwrap();

        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].command, "codex");
        assert_eq!(profiles[1].command, "claude");
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
                command: "custom-agent".to_string(),
                args: vec!["--resume".to_string()],
                env,
            })
            .unwrap();

        assert_eq!(profile.name, "Custom");
        assert_eq!(profile.args, vec!["--resume"]);
        assert_eq!(profile.env.get("MODEL").unwrap(), "fast");
    }
}
