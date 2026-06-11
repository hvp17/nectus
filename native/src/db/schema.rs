use super::{now, Database};
use crate::git_ops;
use crate::models::{AgentKind, DensityMode, ThemeMode};
use rusqlite::{params, OptionalExtension};
use std::path::PathBuf;

/// Default worktree-root pattern for new installs: each project gets its own
/// folder under a single hidden home directory, mirroring `~/.claude` / `~/.codex`.
/// The leading `~` is expanded to `$HOME` by [`git_ops::default_worktree_root_with_pattern`].
pub(super) const DEFAULT_WORKTREE_PATTERN: &str = "~/.nectus/worktrees/{repoName}";

/// The pre-`~/.nectus` default. Databases still carrying it are migrated to
/// [`DEFAULT_WORKTREE_PATTERN`] on open; a customized pattern is left untouched.
const LEGACY_WORKTREE_PATTERN: &str = "../{repoName}-worktrees";

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

                -- A workspace is a durable, named group of repos (VSCode-workspace
                -- style). Membership lives in workspace_repos; a repo may belong to
                -- more than one workspace. See docs/superpowers/specs for the design.
                CREATE TABLE IF NOT EXISTS workspaces (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspace_repos (
                  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                  position INTEGER NOT NULL,
                  PRIMARY KEY (workspace_id, repo_id)
                );

                CREATE INDEX IF NOT EXISTS workspace_repos_workspace_idx
                ON workspace_repos(workspace_id, position);

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

                -- Per-repo working state for a task (Increment B). A task spans 1..N
                -- repos; this is the complete set, one row per repo. For a single-repo
                -- task it mirrors the task's own repo_id/branch_name/worktree_path/pr_url.
                -- `tasks` keeps those columns as the PRIMARY repo's state for the
                -- single-repo fast path; this table is the source of truth for the set.
                CREATE TABLE IF NOT EXISTS task_repos (
                  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                  branch_name TEXT,
                  worktree_path TEXT,
                  pr_url TEXT,
                  position INTEGER NOT NULL,
                  PRIMARY KEY (task_id, repo_id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS task_repos_worktree_path_unique
                ON task_repos(worktree_path)
                WHERE worktree_path IS NOT NULL;

                CREATE UNIQUE INDEX IF NOT EXISTS task_repos_repo_branch_unique
                ON task_repos(repo_id, branch_name)
                WHERE branch_name IS NOT NULL;

                CREATE INDEX IF NOT EXISTS task_repos_task_idx
                ON task_repos(task_id, position);

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

                CREATE TABLE IF NOT EXISTS pr_reviews (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
                  pr_url TEXT NOT NULL,
                  pr_number INTEGER NOT NULL,
                  pr_title TEXT,
                  pr_author TEXT,
                  base_branch TEXT,
                  status TEXT NOT NULL,
                  verdict TEXT,
                  review_output TEXT,
                  last_error TEXT,
                  worktree_path TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS pr_reviews_repo_idx
                ON pr_reviews(repo_id, id);

                CREATE TABLE IF NOT EXISTS pr_review_reviewers (
                  pr_review_id INTEGER NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
                  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
                  position INTEGER NOT NULL,
                  PRIMARY KEY (pr_review_id, reviewer_profile_id)
                );

                CREATE TABLE IF NOT EXISTS pr_review_runs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  pr_review_id INTEGER NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
                  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
                  round INTEGER NOT NULL,
                  verdict TEXT NOT NULL,
                  output TEXT NOT NULL,
                  error TEXT,
                  created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS pr_review_runs_review_idx
                ON pr_review_runs(pr_review_id, id);
                ",
            )
            .map_err(|error| format!("Failed to create database schema: {error}"))?;

        // `pr_reviews.verdict` was added after the table shipped; backfill it on
        // databases created before then. `CREATE TABLE IF NOT EXISTS` never adds
        // columns to an existing table, so this ALTER is the only path for them.
        self.add_column_if_missing("pr_reviews", "verdict", "TEXT")?;
        self.run_migrations()
    }

    /// Add `column` to `table` if it is missing, so older databases pick up
    /// columns introduced after their schema was first created. Idempotent:
    /// a fresh database created with the column already present skips the ALTER.
    /// Add `column` to `table` if it's not already present. Propagates PRAGMA
    /// read errors rather than swallowing them, so a malformed schema read fails
    /// loudly instead of silently skipping a needed migration.
    fn add_column_if_missing(
        &self,
        table: &str,
        column: &str,
        definition: &str,
    ) -> Result<(), String> {
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|error| format!("Failed to inspect {table} columns: {error}"))?;
        let existing = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("Failed to read {table} columns: {error}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read {table} columns: {error}"))?;
        if existing.iter().any(|name| name == column) {
            return Ok(());
        }
        self.conn
            .execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(|error| format!("Failed to add {table}.{column}: {error}"))?;
        Ok(())
    }

    /// Additive, idempotent column migrations for existing databases. The base
    /// schema uses `CREATE TABLE IF NOT EXISTS`, so new columns on existing
    /// tables must be added here. Safe to run on every open.
    pub(super) fn run_migrations(&self) -> Result<(), String> {
        self.add_column_if_missing("tasks", "jira_issue_key", "TEXT")?;
        self.add_column_if_missing("tasks", "jira_issue_summary", "TEXT")?;
        self.add_column_if_missing("tasks", "jira_issue_url", "TEXT")?;
        self.add_column_if_missing("app_settings", "jira_board_jql", "TEXT")?;
        self.add_column_if_missing("app_settings", "jira_site_url", "TEXT")?;
        self.add_column_if_missing("app_settings", "jira_board_project", "TEXT")?;
        self.add_column_if_missing(
            "app_settings",
            "jira_filter_my_issues",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        self.add_column_if_missing(
            "app_settings",
            "jira_filter_unresolved",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        self.add_column_if_missing(
            "app_settings",
            "jira_filter_current_sprint",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        self.add_column_if_missing("app_settings", "jira_rest_email", "TEXT")?;
        self.add_column_if_missing(
            "app_settings",
            "jira_filter_statuses",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        self.add_column_if_missing("app_settings", "jira_filter_epic", "TEXT")?;
        // Consensus PR review: a single-reviewer review is `mode = 'single'`; a
        // multi-model run is `mode = 'consensus'` with the participants tracked in
        // `pr_review_reviewers` and their per-round outputs in `pr_review_runs`.
        self.add_column_if_missing("pr_reviews", "mode", "TEXT NOT NULL DEFAULT 'single'")?;
        self.add_column_if_missing("pr_reviews", "max_rounds", "INTEGER")?;
        self.add_column_if_missing(
            "pr_reviews",
            "rounds_completed",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        self.add_column_if_missing("pr_reviews", "converged", "INTEGER")?;
        // Reviewer session resume for a single PR review, reused on rerun so the
        // reviewer continues its prior review of the (now updated) PR instead of
        // starting over. Preserved across reruns.
        self.add_column_if_missing("pr_reviews", "reviewer_session_id", "TEXT")?;
        // Reviewer session resume: the resolved session id reused across a loop's
        // idle rounds so repeat reviews continue the same conversation instead of
        // booting cold. Reset when the loop is (re)started.
        self.add_column_if_missing("review_loops", "reviewer_session_id", "TEXT")?;
        // Increment B: a task may belong to a workspace, and per-repo working state
        // moves into task_repos. The FK is intentionally omitted from the ALTER
        // (SQLite can't add a REFERENCES column cleanly to an existing table); the
        // app resolves workspace_id against the loaded workspaces and tolerates a
        // dangling id (treated as "no workspace").
        self.add_column_if_missing("tasks", "workspace_id", "INTEGER")?;
        // Backend-owned attention: `needs_input` (the agent is blocked on the user)
        // or NULL. Persisted so the signal survives reload; set when the watcher
        // emits `session_needs_input`, cleared on session start/idle/exit. `idle` is
        // not stored — it is the default state when no attention and no session.
        self.add_column_if_missing("tasks", "attention", "TEXT")?;
        // Archive flag: archived tasks are excluded from every board/list read by
        // default (and from their per-worktree `git status` cost); the rows, the
        // worktrees, and the branches all stay until the task is deleted.
        self.add_column_if_missing("tasks", "archived", "INTEGER NOT NULL DEFAULT 0")?;
        // The original started_at of the last session, so a tmux reattach can
        // re-spawn the Codex rollout watcher with the real session start.
        self.add_column_if_missing("tasks", "last_session_started_at", "TEXT")?;
        // Google retired the Gemini CLI in favor of the Antigravity CLI (`agy`);
        // migrate any existing Gemini profile in place. The stored model may be
        // a legacy Gemini-CLI name — left as-is for the user to update.
        self.conn
            .execute(
                "UPDATE agent_profiles SET agent_kind = 'antigravity', command = 'agy', name = CASE WHEN name = 'Gemini' AND NOT EXISTS (SELECT 1 FROM agent_profiles other WHERE other.name = 'Antigravity' AND other.id != agent_profiles.id) THEN 'Antigravity' ELSE name END WHERE agent_kind = 'gemini'",
                [],
            )
            .map_err(|error| format!("Failed to migrate Gemini profiles: {error}"))?;
        // Opt-in tmux-backed persistent sessions (survive app quit + reattach).
        self.add_column_if_missing(
            "app_settings",
            "persistent_sessions",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        // Sidebar UI preference: fold away a project's / workspace's nested
        // in-flight agent list. A pure presentation flag, 1:1 with the entity.
        self.add_column_if_missing("repos", "collapsed", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("workspaces", "collapsed", "INTEGER NOT NULL DEFAULT 0")?;
        self.migrate_legacy_worktree_pattern()?;
        self.backfill_task_repos()?;
        Ok(())
    }

    /// Seed `task_repos` with one row per existing task (its primary repo), so the
    /// table is the complete per-repo set for every task going forward. Idempotent:
    /// only inserts for tasks that have no `task_repos` row yet. New cross-repo
    /// tasks write their own N rows at creation.
    pub(super) fn backfill_task_repos(&self) -> Result<(), String> {
        self.conn
            .execute(
                "
                INSERT INTO task_repos (task_id, repo_id, branch_name, worktree_path, pr_url, position)
                SELECT t.id, t.repo_id, t.branch_name, t.worktree_path, t.pr_url, 0
                FROM tasks t
                WHERE NOT EXISTS (SELECT 1 FROM task_repos tr WHERE tr.task_id = t.id)
                ",
                [],
            )
            .map_err(|error| format!("Failed to backfill task_repos: {error}"))?;
        Ok(())
    }

    /// One-time data migration: move databases still on the legacy sibling
    /// worktree default (`../{repoName}-worktrees`) onto the `~/.nectus` default
    /// and recompute every repo's stored root from it, exactly as a Settings
    /// change would. Self-guarding and idempotent — once rewritten the pattern
    /// no longer matches the legacy value, and a customized pattern is skipped.
    /// On a fresh database the settings row does not exist yet (it is seeded
    /// after migrations run), so this is a no-op there.
    pub(super) fn migrate_legacy_worktree_pattern(&self) -> Result<(), String> {
        let current: Option<String> = self
            .conn
            .query_row(
                "SELECT default_worktree_root_pattern FROM app_settings WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Failed to read worktree pattern: {error}"))?;
        if current.as_deref() != Some(LEGACY_WORKTREE_PATTERN) {
            return Ok(());
        }
        self.conn
            .execute(
                "UPDATE app_settings SET default_worktree_root_pattern = ?1 WHERE id = 1",
                params![DEFAULT_WORKTREE_PATTERN],
            )
            .map_err(|error| format!("Failed to migrate worktree pattern: {error}"))?;
        self.refresh_repo_worktree_roots(DEFAULT_WORKTREE_PATTERN)
    }

    pub(super) fn seed_agent_profiles(&self) -> Result<(), String> {
        let now = now();
        for (name, kind, command) in [
            ("Codex", AgentKind::Codex, "codex"),
            ("Claude", AgentKind::Claude, "claude"),
            ("Antigravity", AgentKind::Antigravity, "agy"),
            ("OpenCode", AgentKind::OpenCode, "opencode"),
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
                    DEFAULT_WORKTREE_PATTERN,
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
