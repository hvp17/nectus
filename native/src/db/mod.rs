use crate::git_ops;
#[cfg(test)]
use crate::models::{
    AgentKind, AgentProfileInput, AppSettings, AppSettingsInput, DensityMode, PrReviewMode,
    PrReviewRunInput, PrReviewStatus, PrReviewVerdict, ReviewLoopStatus, ReviewRunInput,
    ReviewVerdict, TaskStatus, TaskSummary, ThemeMode,
};
use crate::models::Repo;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
#[cfg(test)]
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

mod agent_profiles;
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
        let db = Self { conn };
        db.create_schema()?;
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
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn generated_branch_name() -> String {
    format!("task-{}", Uuid::new_v4())
}

#[cfg(test)]
mod tests;
