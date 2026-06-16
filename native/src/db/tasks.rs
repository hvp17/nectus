use super::rows::{rows, task_from_row, task_repo_from_row};
use super::{generated_branch_name, now, Database};
use crate::git_ops;
use crate::models::{Repo, TaskRepo, TaskStatus, TaskSummary};
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

impl Database {
    /// Resolve the branch name and worktree path for a single-repo worktree task
    /// **without creating the worktree or hitting the network** — a fast DB read
    /// plus pure path logic. The command layer calls this under a brief lock,
    /// releases the lock, runs the slow `git` worktree creation off-lock, then
    /// re-locks only for [`insert_task`]. Returns the repo too (its path is needed
    /// to create and, on failure, to clean up the worktree).
    pub fn worktree_plan(
        &self,
        repo_id: i64,
        branch_name: Option<String>,
    ) -> Result<(Repo, String, PathBuf), String> {
        let repo = self
            .repo_by_id(repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let branch_name = branch_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(generated_branch_name);
        git_ops::validate_branch_name(&branch_name)?;
        let worktree_path = PathBuf::from(&repo.default_worktree_root).join(&branch_name);
        Ok((repo, branch_name, worktree_path))
    }

    /// Insert a task row and its primary `task_repos` row atomically, returning the
    /// DB-only task (no `git status`). **Pure SQLite** — any worktree must already
    /// exist — so it holds the DB lock only briefly, off the network-git path.
    pub fn insert_task(
        &self,
        repo_id: i64,
        title: String,
        prompt: Option<String>,
        agent_profile_id: Option<i64>,
        branch_name: Option<&str>,
        worktree_path: Option<&str>,
    ) -> Result<TaskSummary, String> {
        let has_worktree = branch_name.is_some();
        let now = now();
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("Failed to begin task transaction: {error}"))?;
        tx.execute(
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
        let task_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO task_repos (task_id, repo_id, branch_name, worktree_path, pr_url, position) VALUES (?1, ?2, ?3, ?4, NULL, 0)",
            params![task_id, repo_id, branch_name, worktree_path],
        )
        .map_err(|error| format!("Failed to save task repo: {error}"))?;
        tx.commit()
            .map_err(|error| format!("Failed to commit task: {error}"))?;

        self.task_by_id(task_id)?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
    }

    /// Create a single task, optionally worktree-backed, in one call — the
    /// all-in-one convenience used by the DB tests. Production code (the command
    /// layer) instead drives [`worktree_plan`] + [`insert_task`] directly so the
    /// network `git` runs off the lock, so this is test-only.
    #[cfg(test)]
    pub fn create_task_record(
        &self,
        repo_id: i64,
        title: String,
        prompt: Option<String>,
        agent_profile_id: Option<i64>,
        has_worktree: bool,
        branch_name: Option<String>,
    ) -> Result<TaskSummary, String> {
        if !has_worktree {
            return self.insert_task(repo_id, title, prompt, agent_profile_id, None, None);
        }
        let (repo, branch_name, worktree_path) = self.worktree_plan(repo_id, branch_name)?;
        git_ops::create_worktree(Path::new(&repo.path), &worktree_path, &branch_name)?;
        let worktree_path_value = worktree_path.to_string_lossy().to_string();
        // A re-used branch (unique-index trip) would leave an untracked worktree
        // that delete_task can't see; compensate by force-removing the freshly
        // created, app-owned worktree (discards no user work).
        self.insert_task(
            repo_id,
            title,
            prompt,
            agent_profile_id,
            Some(&branch_name),
            Some(&worktree_path_value),
        )
        .inspect_err(|_| {
            let _ = git_ops::remove_worktree(Path::new(&repo.path), &worktree_path, true);
        })
    }

    /// Resolve everything a cross-repo task needs — repos, sibling folder names,
    /// the shared parent path, branch, and the layout-prefixed prompt — as a fast
    /// DB read plus pure logic, **without creating any worktree**. The command
    /// holds the lock only for this, then creates the worktrees off-lock via
    /// [`CrossRepoPlan::create_worktrees`] before re-locking for
    /// [`insert_cross_repo_task`].
    pub fn cross_repo_plan(
        &self,
        repo_ids: Vec<i64>,
        branch_name: Option<String>,
        prompt: Option<String>,
    ) -> Result<CrossRepoPlan, String> {
        // Dedupe preserving order; a cross-repo task needs at least two distinct repos.
        let mut seen = HashSet::new();
        let repo_ids: Vec<i64> = repo_ids.into_iter().filter(|id| seen.insert(*id)).collect();
        if repo_ids.len() < 2 {
            return Err("A cross-repo task needs at least two repositories".to_string());
        }

        let mut repos = Vec::with_capacity(repo_ids.len());
        for repo_id in &repo_ids {
            repos.push(
                self.repo_by_id(*repo_id)?
                    .ok_or_else(|| format!("Repository {repo_id} not found"))?,
            );
        }

        let branch_name = branch_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(generated_branch_name);
        git_ops::validate_branch_name(&branch_name)?;

        // Shared parent next to the per-repo worktree roots:
        // `<…/.nectus/worktrees>/workspaces/<branch>/<folder>`. Each repo's worktree
        // is a sibling under it; the primary's is the session cwd. Sibling folders use
        // the repo name, disambiguated by id when two repos share a directory name.
        let base = PathBuf::from(&repos[0].default_worktree_root);
        let parent = base
            .parent()
            .map(|root| root.join("workspaces"))
            .unwrap_or_else(|| base.join("workspaces"))
            .join(&branch_name);
        let folders = unique_worktree_folders(&repos);
        let prompt = Some(cross_repo_prompt(&folders, prompt));

        Ok(CrossRepoPlan {
            repos,
            folders,
            parent,
            branch_name,
            prompt,
        })
    }

    /// Insert the cross-repo task row plus one `task_repos` row per repo, all in
    /// one transaction, and return the DB-only task. **Pure SQLite** — the
    /// worktrees in `plan` must already exist (created off-lock).
    pub fn insert_cross_repo_task(
        &self,
        plan: &CrossRepoPlan,
        workspace_id: Option<i64>,
        title: String,
        agent_profile_id: Option<i64>,
    ) -> Result<TaskSummary, String> {
        let primary_worktree = plan.worktree_path(0).to_string_lossy().to_string();
        let now = now();
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|error| format!("Failed to begin task transaction: {error}"))?;
        tx.execute(
            "
            INSERT INTO tasks
              (repo_id, workspace_id, title, prompt, status, pr_url, agent_profile_id, active_session_id, last_session_id, last_session_agent, last_session_cwd, last_session_label, has_worktree, branch_name, worktree_path, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
            ",
            params![
                plan.repos[0].id,
                workspace_id,
                title,
                plan.prompt.as_deref(),
                TaskStatus::Planned.as_str(),
                None::<String>,
                agent_profile_id,
                None::<String>,
                None::<String>,
                None::<String>,
                None::<String>,
                None::<String>,
                true,
                plan.branch_name.as_str(),
                primary_worktree,
                now
            ],
        )
        .map_err(|error| format!("Failed to save task: {error}"))?;
        let task_id = tx.last_insert_rowid();
        for (index, repo) in plan.repos.iter().enumerate() {
            let worktree_path = plan.worktree_path(index).to_string_lossy().to_string();
            tx.execute(
                "INSERT INTO task_repos (task_id, repo_id, branch_name, worktree_path, pr_url, position) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                params![task_id, repo.id, plan.branch_name.as_str(), worktree_path, index as i64],
            )
            .map_err(|error| format!("Failed to save task repo: {error}"))?;
        }
        tx.commit()
            .map_err(|error| format!("Failed to commit task: {error}"))?;

        self.task_by_id(task_id)?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
    }

    /// Create a task that spans several repos (Increment B): a worktree per repo
    /// on a shared branch, laid out as siblings under one parent so a single agent
    /// session (rooted in the primary repo's worktree) can reach the others at
    /// `../<repoName>`. Built from [`cross_repo_plan`] +
    /// [`CrossRepoPlan::create_worktrees`] + [`insert_cross_repo_task`]; the
    /// command layer drives those directly so the network `git` runs off the lock,
    /// so this all-in-one wrapper is test-only.
    #[cfg(test)]
    pub fn create_cross_repo_task(
        &self,
        workspace_id: Option<i64>,
        repo_ids: Vec<i64>,
        title: String,
        prompt: Option<String>,
        agent_profile_id: Option<i64>,
        branch_name: Option<String>,
    ) -> Result<TaskSummary, String> {
        let plan = self.cross_repo_plan(repo_ids, branch_name, prompt)?;
        plan.create_worktrees()?;
        self.insert_cross_repo_task(&plan, workspace_id, title, agent_profile_id)
            .inspect_err(|_| plan.teardown_worktrees())
    }

    /// Load a task's per-repo working state (Increment B), in display order, each
    /// joined to its repo for the name. Every task has at least one row.
    pub fn task_repos_for(&self, task_id: i64) -> Result<Vec<TaskRepo>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT tr.repo_id, r.name, tr.branch_name, tr.worktree_path, tr.pr_url, tr.position
                FROM task_repos tr
                JOIN repos r ON r.id = tr.repo_id
                WHERE tr.task_id = ?1
                ORDER BY tr.position
                ",
            )
            .map_err(|error| error.to_string())?;
        let result = rows(
            stmt.query_map(params![task_id], task_repo_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    /// List tasks, scoped to one visibility: `archived = false` is every live
    /// board/list read; `archived = true` is the explicit archive view. Keeping
    /// archived rows out of the default read also keeps them out of the
    /// command layer's per-worktree `git status` pass.
    pub fn list_tasks(
        &self,
        repo_id: Option<i64>,
        archived: bool,
    ) -> Result<Vec<TaskSummary>, String> {
        let sql = "
            SELECT t.id, t.repo_id, t.title, t.prompt, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
                   t.has_worktree, t.branch_name, t.worktree_path, t.active_session_id,
                   t.last_session_id, t.last_session_agent, t.last_session_cwd, t.last_session_label,
                   t.created_at, t.updated_at,
                   rl.status,
                   t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url, t.workspace_id,
                   t.attention, t.archived
            FROM tasks t
            LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
            LEFT JOIN review_loops rl ON rl.task_id = t.id
        ";

        // A pure DB read: worktree dirtiness (a `git status` subprocess per repo)
        // is intentionally NOT computed here. It is filled in off the DB lock at
        // the command layer (`list_tasks`) so a board load doesn't serialize N
        // git subprocesses inside the global mutex.
        //
        // For a multi-repo task, `repo_id` matches if ANY of the task's repos is
        // that repo (a task is visible under every project it spans), resolved via
        // the task_repos membership.
        let mut tasks = if let Some(repo_id) = repo_id {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "{sql} WHERE t.archived = ?2 AND EXISTS (SELECT 1 FROM task_repos tr WHERE tr.task_id = t.id AND tr.repo_id = ?1) ORDER BY t.updated_at DESC"
                ))
                .map_err(|error| error.to_string())?;
            let mapped = rows(
                stmt.query_map(params![repo_id, archived], task_from_row)
                    .map_err(|error| error.to_string())?,
            );
            mapped?
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "{sql} WHERE t.archived = ?1 ORDER BY t.updated_at DESC"
                ))
                .map_err(|error| error.to_string())?;
            let mapped = rows(
                stmt.query_map(params![archived], task_from_row)
                    .map_err(|error| error.to_string())?,
            );
            mapped?
        };
        // One bulk query for every task's per-repo rows instead of one query per
        // task — the board load is O(2 queries), not O(tasks).
        let mut repos_by_task = self.task_repos_by_task()?;
        for task in tasks.iter_mut() {
            task.task_repos = repos_by_task.remove(&task.id).unwrap_or_default();
        }
        Ok(tasks)
    }

    /// Load every task's per-repo rows in one query, grouped by task id — the
    /// bulk companion to [`task_repos_for`] used by [`list_tasks`].
    fn task_repos_by_task(&self) -> Result<HashMap<i64, Vec<TaskRepo>>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "
                SELECT tr.repo_id, r.name, tr.branch_name, tr.worktree_path, tr.pr_url, tr.position, tr.task_id
                FROM task_repos tr
                JOIN repos r ON r.id = tr.repo_id
                ORDER BY tr.task_id, tr.position
                ",
            )
            .map_err(|error| error.to_string())?;
        let mapped = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(6)?, task_repo_from_row(row)?))
            })
            .map_err(|error| error.to_string())?;
        let mut grouped: HashMap<i64, Vec<TaskRepo>> = HashMap::new();
        for entry in mapped {
            let (task_id, task_repo) = entry.map_err(|error| error.to_string())?;
            grouped.entry(task_id).or_default().push(task_repo);
        }
        Ok(grouped)
    }

    /// Load a task and its per-repo state from SQLite only — **no `git status`**,
    /// so it runs no subprocess and is safe to call while holding the DB lock.
    /// `is_dirty` stays `false`; compute it off-lock when actually needed (the
    /// command layer does, via `fill_task_dirtiness` in `lib.rs`). Every DB-layer
    /// caller holds the lock, so dirtiness is never computed here.
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
                       t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url, t.workspace_id,
                       t.attention, t.archived
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
        let Some(mut task) = row else {
            return Ok(None);
        };
        task.task_repos = self.task_repos_for(id)?;
        Ok(Some(task))
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

    /// Archive (or restore) a task. Archived tasks vanish from the default
    /// board/list reads but keep their row, worktree, and branch until deleted.
    pub fn set_task_archived(&self, task_id: i64, archived: bool) -> Result<TaskSummary, String> {
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        self.conn
            .execute(
                "UPDATE tasks SET archived = ?1, updated_at = ?2 WHERE id = ?3",
                params![archived, now(), task_id],
            )
            .map_err(|error| format!("Failed to update task: {error}"))?;
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found after update".into())
    }

    /// Set the per-repo PR URL on a cross-repo task's member row. The primary
    /// repo's PR lives on `tasks.pr_url` (set via [`update_task_metadata`]); this
    /// records a non-primary member's PR on its `task_repos` row.
    pub fn set_task_repo_pr_url(
        &self,
        task_id: i64,
        repo_id: i64,
        pr_url: &str,
    ) -> Result<TaskSummary, String> {
        let updated = self
            .conn
            .execute(
                "UPDATE task_repos SET pr_url = ?1 WHERE task_id = ?2 AND repo_id = ?3",
                params![pr_url, task_id, repo_id],
            )
            .map_err(|error| format!("Failed to save repo PR URL: {error}"))?;
        if updated == 0 {
            return Err("Task has no entry for that repository".to_string());
        }
        self.conn
            .execute(
                "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
                params![now(), task_id],
            )
            .map_err(|error| format!("Failed to touch task: {error}"))?;
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

    /// Resolve what deleting a task entails — its per-repo worktrees — as a fast
    /// DB read after guarding against a missing task. Pairs
    /// with [`TaskDeletionPlan::remove_worktrees`] (off-lock git) and
    /// [`delete_task_row`]; splitting it this way keeps the `git worktree remove`
    /// subprocesses off the global DB lock (mirroring task creation). Uses the
    /// DB-only load so it never shells out to `git status` under the lock.
    pub fn plan_task_deletion(&self, task_id: i64) -> Result<TaskDeletionPlan, String> {
        let existing = self
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;

        let mut worktrees = Vec::new();
        for task_repo in &existing.task_repos {
            if let Some(worktree_path) = &task_repo.worktree_path {
                let repo = self
                    .repo_by_id(task_repo.repo_id)?
                    .ok_or_else(|| "Repository not found".to_string())?;
                worktrees.push(TaskWorktree {
                    repo_path: repo.path,
                    branch_name: task_repo.branch_name.clone(),
                    worktree_path: worktree_path.clone(),
                });
            }
        }
        Ok(TaskDeletionPlan { worktrees })
    }

    /// Legacy PTY sessions are no longer reattached. Clear stale active markers
    /// on boot so old rows cannot block ACP-only workflows.
    pub fn clear_legacy_active_sessions(&self) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = NULL, attention = NULL, updated_at = ?1 WHERE active_session_id IS NOT NULL OR attention IS NOT NULL",
                params![now()],
            )
            .map_err(|error| format!("Failed to clear legacy active sessions: {error}"))?;
        Ok(())
    }

    /// Delete the task row. `task_repos` rows cascade-delete with it. Run after the
    /// worktrees are removed (off-lock) so a failed removal leaves the row intact.
    pub fn delete_task_row(&self, task_id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
            .map_err(|error| format!("Failed to delete task: {error}"))?;
        Ok(())
    }

    /// Delete a task and, for worktree-backed tasks, remove its worktree(s) — the
    /// all-in-one convenience for the DB tests. Production code (the command
    /// layer) drives [`plan_task_deletion`] + [`TaskDeletionPlan::remove_worktrees`]
    /// + [`delete_task_row`] so the git runs off the lock.
    #[cfg(test)]
    pub fn delete_task(&self, task_id: i64, force: bool) -> Result<(), String> {
        let plan = self.plan_task_deletion(task_id)?;
        plan.remove_worktrees(force)?;
        self.delete_task_row(task_id)
    }
}

/// One repo's worktree to remove when deleting a task (a cross-repo task has
/// several). Resolved by [`Database::plan_task_deletion`].
struct TaskWorktree {
    repo_path: String,
    branch_name: Option<String>,
    worktree_path: String,
}

/// The worktrees a task delete must remove, resolved up front so the `git`
/// removal can run off the global DB lock (the slow part), with only the row
/// delete locked afterwards.
pub struct TaskDeletionPlan {
    worktrees: Vec<TaskWorktree>,
}

impl TaskDeletionPlan {
    /// Remove every worktree, off any lock. Without `force`, an **all-or-nothing**
    /// dirtiness check runs first, so a multi-repo delete never removes one repo's
    /// worktree before failing on another's uncommitted work (the caller then
    /// confirms and retries with `force`). Each removal also prunes stale worktree
    /// admin entries and deletes the now-orphaned `task-*` branch (see
    /// [`git_ops::cleanup_task_branch`]). A mid-loop failure for a non-dirty reason
    /// leaves the row intact and self-heals on retry (gone worktrees are clean and
    /// short-circuit).
    pub fn remove_worktrees(&self, force: bool) -> Result<(), String> {
        if !force {
            for worktree in &self.worktrees {
                if git_ops::is_dirty(Path::new(&worktree.worktree_path)) {
                    return Err(git_ops::WORKTREE_HAS_CHANGES.to_string());
                }
            }
        }
        for worktree in &self.worktrees {
            let repo_path = Path::new(&worktree.repo_path);
            git_ops::remove_worktree(repo_path, Path::new(&worktree.worktree_path), force)?;
            git_ops::prune_worktrees(repo_path);
            if let Some(branch) = &worktree.branch_name {
                git_ops::cleanup_task_branch(repo_path, branch);
            }
        }
        Ok(())
    }
}

/// The fully-resolved layout for a cross-repo task — repos, sibling folder names,
/// the shared parent path, the branch, and the layout-prefixed prompt — computed
/// before any git runs. Created by [`Database::cross_repo_plan`]; the worktree
/// creation/teardown it owns touches only the filesystem and `git`, never the DB,
/// so it runs off the global lock.
pub struct CrossRepoPlan {
    pub repos: Vec<Repo>,
    folders: Vec<String>,
    parent: PathBuf,
    pub branch_name: String,
    prompt: Option<String>,
}

impl CrossRepoPlan {
    /// The worktree path for the repo at `index` (sibling folder under `parent`).
    pub fn worktree_path(&self, index: usize) -> PathBuf {
        self.parent.join(&self.folders[index])
    }

    /// Create every repo's worktree **concurrently** (off any lock) — they are
    /// independent and each does its own network fetch, so serial creation costs
    /// the sum of those fetches (tens of seconds across several large repos). On
    /// any failure, tears down the worktrees that did get created and returns the
    /// first error.
    pub fn create_worktrees(&self) -> Result<(), String> {
        let outcomes: Vec<(usize, Result<(), String>)> = std::thread::scope(|scope| {
            let handles: Vec<_> = self
                .repos
                .iter()
                .enumerate()
                .map(|(index, repo)| {
                    let worktree_path = self.worktree_path(index);
                    let branch_name = self.branch_name.as_str();
                    scope.spawn(move || {
                        (
                            index,
                            git_ops::create_worktree(
                                Path::new(&repo.path),
                                &worktree_path,
                                branch_name,
                            ),
                        )
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().expect("worktree creation thread panicked"))
                .collect()
        });

        let mut created: Vec<usize> = Vec::new();
        let mut failure: Option<String> = None;
        for (index, result) in outcomes {
            match result {
                Ok(()) => created.push(index),
                Err(error) if failure.is_none() => {
                    failure = Some(format!(
                        "Failed to create worktree for {}: {error}",
                        self.repos[index].name
                    ));
                }
                Err(_) => {}
            }
        }
        if let Some(error) = failure {
            for &index in &created {
                let _ = git_ops::remove_worktree(
                    Path::new(&self.repos[index].path),
                    &self.worktree_path(index),
                    true,
                );
            }
            return Err(error);
        }
        Ok(())
    }

    /// Force-remove every repo's worktree. Used to compensate when the DB insert
    /// fails after the worktrees were created — they are fresh, app-owned, and
    /// empty, so this discards no user work.
    pub fn teardown_worktrees(&self) {
        for index in 0..self.repos.len() {
            let _ = git_ops::remove_worktree(
                Path::new(&self.repos[index].path),
                &self.worktree_path(index),
                true,
            );
        }
    }
}

/// Per-repo sibling folder names for a cross-repo task: the repo name, made unique
/// (when two repos share a name) by appending the repo id, then a counter if even
/// that collides with an already-chosen folder. Guarantees all-distinct folders so
/// the sibling worktree paths under the shared parent never clash.
fn unique_worktree_folders(repos: &[Repo]) -> Vec<String> {
    let mut used: HashSet<String> = HashSet::new();
    repos
        .iter()
        .map(|repo| {
            let mut candidate = repo.name.clone();
            if used.contains(&candidate) {
                candidate = format!("{}-{}", repo.name, repo.id);
            }
            let mut suffix = 2;
            while used.contains(&candidate) {
                candidate = format!("{}-{}-{}", repo.name, repo.id, suffix);
                suffix += 1;
            }
            used.insert(candidate.clone());
            candidate
        })
        .collect()
}

/// Prepend cross-repo context to the user's prompt so the single agent knows the
/// task spans several repos and where the siblings are checked out relative to its
/// working directory (the primary repo's worktree). `folders` are the per-repo
/// sibling directory names, primary first.
fn cross_repo_prompt(folders: &[String], prompt: Option<String>) -> String {
    let siblings = folders[1..]
        .iter()
        .map(|folder| format!("`../{folder}`"))
        .collect::<Vec<_>>()
        .join(", ");
    let context = format!(
        "This task spans {} repositories. Your working directory is the `{}` repo; the other repos are checked out as siblings at: {}. Make coordinated changes across them as needed.",
        folders.len(),
        folders[0],
        siblings
    );
    match prompt {
        Some(prompt) if !prompt.trim().is_empty() => format!("{context}\n\n{prompt}"),
        _ => context,
    }
}

#[cfg(test)]
mod folder_tests {
    use super::*;

    fn repo(name: &str, id: i64) -> Repo {
        Repo {
            id,
            name: name.to_string(),
            path: String::new(),
            default_worktree_root: String::new(),
            created_at: String::new(),
            collapsed: false,
        }
    }

    #[test]
    fn unique_worktree_folders_disambiguate_even_when_the_id_fallback_collides() {
        // A repo literally named "api-6" alongside two repos named "api" (one with
        // id 6) would make the `{name}-{id}` fallback collide; the counter resolves it.
        let folders = unique_worktree_folders(&[repo("api-6", 8), repo("api", 5), repo("api", 6)]);
        let distinct: std::collections::HashSet<_> = folders.iter().collect();
        assert_eq!(
            distinct.len(),
            3,
            "all folders must be distinct: {folders:?}"
        );
        assert_eq!(folders[0], "api-6");
        assert_eq!(folders[1], "api");
    }
}
