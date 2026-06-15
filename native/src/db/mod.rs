use crate::git_ops;
use crate::models::Repo;
#[cfg(test)]
use crate::models::{
    AgentKind, AgentProfileInput, AppSettingsInput, DensityMode, PrReviewMode, PrReviewRunInput,
    PrReviewStatus, PrReviewVerdict, ReviewLoopStatus, ReviewRunInput, ReviewVerdict, TaskStatus,
    ThemeMode,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
#[cfg(test)]
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

mod agent_profiles;
mod chat;
mod pr_reviews;
mod review_loops;
mod rows;
mod schema;
mod sessions;
mod settings;
mod tasks;
mod workspaces;

use rows::{repo_from_row, rows};

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
        // `foreign_keys` is per-connection (not persisted), so enforce it here at
        // open — not only in the schema batch — so the ON DELETE CASCADE/SET NULL
        // constraints always hold for this connection.
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;
        // Write-Ahead Logging: faster commits (append to the WAL instead of
        // rewriting a rollback journal each time) and readers don't block the
        // writer. `synchronous=NORMAL` is the safe, recommended pairing with WAL
        // for an app database (durable across app crashes; only a power loss can
        // lose the last commit). `busy_timeout` lets a momentarily-locked write
        // wait briefly instead of erroring. WAL is persisted on the database file,
        // but setting it per-connection is cheap and harmless.
        configure_pragmas(&conn)?;
        let db = Self { conn };
        db.create_schema()?;
        db.seed_agent_profiles()?;
        db.seed_app_settings()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|error| error.to_string())?;
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;
        // In-memory has no WAL/file to worry about; foreign keys is enough.
        let db = Self { conn };
        db.create_schema()?;
        db.seed_agent_profiles()?;
        db.seed_app_settings()?;
        Ok(db)
    }

    /// Validate-then-insert convenience for the DB tests. Production code (the
    /// command layer) runs the `git rev-parse` validation OFF the lock and calls
    /// [`insert_repo`] directly, so this is test-only.
    #[cfg(test)]
    pub fn add_repo(&self, path: String) -> Result<Repo, String> {
        let repo_path = std::fs::canonicalize(&path)
            .map_err(|error| format!("Failed to resolve repository path: {error}"))?;
        git_ops::validate_repo_path(&repo_path)?;
        self.insert_repo(&repo_path)
    }

    /// Insert (or refresh) a project row for an already-validated, canonical
    /// repository path. **Pure SQLite** — the caller must have validated the
    /// path off the lock (`git rev-parse` is a subprocess).
    pub fn insert_repo(&self, repo_path: &std::path::Path) -> Result<Repo, String> {
        let name = repo_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Repository")
            .to_string();
        let settings = self.get_app_settings()?;
        let default_root = git_ops::default_worktree_root_with_pattern(
            repo_path,
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
                "SELECT id, name, path, default_worktree_root, created_at, collapsed FROM repos ORDER BY name",
            )
            .map_err(|error| error.to_string())?;
        let result = rows(
            stmt.query_map([], repo_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    pub fn repo_by_id(&self, id: i64) -> Result<Option<Repo>, String> {
        self.conn
            .query_row(
                "SELECT id, name, path, default_worktree_root, created_at, collapsed FROM repos WHERE id = ?1",
                params![id],
                repo_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn repo_by_path(&self, path: &str) -> Result<Option<Repo>, String> {
        self.conn
            .query_row(
                "SELECT id, name, path, default_worktree_root, created_at, collapsed FROM repos WHERE path = ?1",
                params![path],
                repo_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    /// Persist the sidebar fold state of a project's nested agent list.
    pub fn set_repo_collapsed(&self, id: i64, collapsed: bool) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE repos SET collapsed = ?1 WHERE id = ?2",
                params![collapsed, id],
            )
            .map_err(|error| format!("Failed to update project: {error}"))?;
        Ok(())
    }

    /// Rename a project's display name. The on-disk path and worktree root are
    /// untouched — the name is a UI label (it also seeds new cross-repo sibling
    /// folder names, which disambiguate by id on collision anyway).
    pub fn rename_repo(&self, id: i64, name: String) -> Result<Repo, String> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Project name cannot be empty".to_string());
        }
        let duplicate: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM repos WHERE name = ?1 COLLATE NOCASE AND id != ?2",
                params![name, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if duplicate.is_some() {
            return Err(format!("A project named \"{name}\" already exists"));
        }
        let updated = self
            .conn
            .execute(
                "UPDATE repos SET name = ?1 WHERE id = ?2",
                params![name, id],
            )
            .map_err(|error| format!("Failed to rename project: {error}"))?;
        if updated == 0 {
            return Err("Repository not found".to_string());
        }
        self.repo_by_id(id)?
            .ok_or_else(|| "Repository not found after rename".into())
    }

    /// Remove a project from Nectus. **Refuses while any task references it**:
    /// `tasks.repo_id` cascades, so deleting the row would silently drop tasks
    /// and orphan their worktrees on disk. With no tasks left, the row delete
    /// cascades only workspace membership and PR-review history; the repository
    /// on disk is never touched.
    pub fn remove_repo(&self, id: i64) -> Result<(), String> {
        self.repo_by_id(id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let task_count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT task_id) FROM task_repos WHERE repo_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if task_count > 0 {
            return Err(format!(
                "This project still has {task_count} task{} — delete them first (removing a project never deletes tasks or worktrees for you)",
                if task_count == 1 { "" } else { "s" }
            ));
        }
        self.conn
            .execute("DELETE FROM repos WHERE id = ?1", params![id])
            .map_err(|error| format!("Failed to remove project: {error}"))?;
        Ok(())
    }
}

/// Apply the connection pragmas for the on-disk database: WAL journaling plus its
/// safe `synchronous=NORMAL` pairing, and a short `busy_timeout`. WAL makes
/// commits cheaper and lets reads proceed without blocking the writer; the busy
/// timeout absorbs a brief write contention instead of erroring.
fn configure_pragmas(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Failed to enable WAL journal mode: {error}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("Failed to set synchronous mode: {error}"))?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(|error| format!("Failed to set busy timeout: {error}"))?;
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn generated_branch_name() -> String {
    format!("task-{}", Uuid::new_v4())
}

#[cfg(test)]
mod invariants;
#[cfg(test)]
mod tests;
