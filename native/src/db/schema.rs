use super::{now, Database};
use crate::git_ops;
use crate::models::{AgentKind, DensityMode, ThemeMode};
use rusqlite::params;
use std::path::PathBuf;

impl Database {
    pub(super) fn create_schema(&self) -> Result<(), String> {
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
                  prompt TEXT,
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

                CREATE TABLE IF NOT EXISTS review_loops (
                  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
                  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
                  status TEXT NOT NULL,
                  last_error TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS review_runs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
                  verdict TEXT NOT NULL,
                  prompt TEXT NOT NULL,
                  output TEXT NOT NULL,
                  error TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS review_runs_task_idx
                ON review_runs(task_id, id);
                ",
            )
            .map_err(|error| format!("Failed to create database schema: {error}"))
    }

    pub(super) fn seed_agent_profiles(&self) -> Result<(), String> {
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

    pub(super) fn seed_app_settings(&self) -> Result<(), String> {
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

    pub(super) fn refresh_repo_worktree_roots(&self, pattern: &str) -> Result<(), String> {
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
                .map_err(|error| {
                    format!(
                        "Failed to refresh default worktree root for {}: {error}",
                        repo.name
                    )
                })?;
        }
        Ok(())
    }
}
