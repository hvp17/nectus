use super::rows::{rows, task_from_row, task_repo_from_row};
use super::{generated_branch_name, now, Database};
use crate::git_ops;
use crate::models::{Repo, TaskRepo, TaskStatus, TaskSummary};
use rusqlite::{params, OptionalExtension};
use std::collections::HashSet;
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
        // Insert the task and its single (primary) task_repos row atomically, so a
        // task never exists without its per-repo working state.
        let inserted = (|| -> Result<i64, String> {
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
                    worktree_path_value,
                    now
                ],
            )
            .map_err(|error| format!("Failed to save task: {error}"))?;
            let task_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO task_repos (task_id, repo_id, branch_name, worktree_path, pr_url, position) VALUES (?1, ?2, ?3, ?4, NULL, 0)",
                params![task_id, repo_id, branch_name, worktree_path_value],
            )
            .map_err(|error| format!("Failed to save task repo: {error}"))?;
            tx.commit()
                .map_err(|error| format!("Failed to commit task: {error}"))?;
            Ok(task_id)
        })();

        let task_id = match inserted {
            Ok(task_id) => task_id,
            Err(error) => {
                // The worktree is created on disk before this INSERT, so a failure
                // here (e.g. a re-used branch tripping the unique index) would leave
                // an untracked worktree that delete_task can't see and that blocks
                // every retry with "Worktree path already exists". Compensate by
                // removing it — it is a freshly created, app-owned worktree, so the
                // force removal discards no user work.
                if let Some(path) = &worktree_path {
                    let _ =
                        git_ops::remove_worktree(PathBuf::from(&repo.path).as_path(), path, true);
                }
                return Err(error);
            }
        };

        self.task_by_id(task_id)?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
    }

    /// Create a task that spans several repos (Increment B). Each repo gets its own
    /// worktree on a shared branch, laid out as siblings under one parent folder, so
    /// a single agent session (rooted in the primary repo's worktree) can reach the
    /// others at `../<repoName>`. The first repo is the primary. All worktrees are
    /// created up front; any failure rolls back the ones already made.
    pub fn create_cross_repo_task(
        &self,
        workspace_id: Option<i64>,
        repo_ids: Vec<i64>,
        title: String,
        prompt: Option<String>,
        agent_profile_id: Option<i64>,
        branch_name: Option<String>,
    ) -> Result<TaskSummary, String> {
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
        let primary = &repos[0];

        let branch_name = branch_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(generated_branch_name);
        git_ops::validate_branch_name(&branch_name)?;

        // Shared parent next to the per-repo worktree roots:
        // `<…/.nectus/worktrees>/workspaces/<branch>/<folder>`. Each repo's worktree
        // is a sibling under it; the primary's is the session cwd. Sibling folders use
        // the repo name, disambiguated by id when two repos share a directory name.
        let base = PathBuf::from(&primary.default_worktree_root);
        let parent = base
            .parent()
            .map(|root| root.join("workspaces"))
            .unwrap_or_else(|| base.join("workspaces"))
            .join(&branch_name);

        let folders = unique_worktree_folders(&repos);

        // Create every worktree first; on any failure tear down the ones made so far.
        let mut created: Vec<usize> = Vec::new();
        for (index, repo) in repos.iter().enumerate() {
            let worktree_path = parent.join(&folders[index]);
            if let Err(error) =
                git_ops::create_worktree(Path::new(&repo.path), &worktree_path, &branch_name)
            {
                for created_index in &created {
                    let _ = git_ops::remove_worktree(
                        Path::new(&repos[*created_index].path),
                        &parent.join(&folders[*created_index]),
                        true,
                    );
                }
                return Err(format!(
                    "Failed to create worktree for {}: {error}",
                    repo.name
                ));
            }
            created.push(index);
        }

        let prompt = Some(cross_repo_prompt(&folders, prompt));
        let primary_worktree = parent.join(&folders[0]).to_string_lossy().to_string();
        let now = now();

        let inserted = (|| -> Result<i64, String> {
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
                    primary.id,
                    workspace_id,
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
                    true,
                    branch_name,
                    primary_worktree,
                    now
                ],
            )
            .map_err(|error| format!("Failed to save task: {error}"))?;
            let task_id = tx.last_insert_rowid();
            for (index, repo) in repos.iter().enumerate() {
                let worktree_path = parent.join(&folders[index]).to_string_lossy().to_string();
                tx.execute(
                    "INSERT INTO task_repos (task_id, repo_id, branch_name, worktree_path, pr_url, position) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                    params![task_id, repo.id, branch_name, worktree_path, index as i64],
                )
                .map_err(|error| format!("Failed to save task repo: {error}"))?;
            }
            tx.commit()
                .map_err(|error| format!("Failed to commit task: {error}"))?;
            Ok(task_id)
        })();

        let task_id = match inserted {
            Ok(task_id) => task_id,
            Err(error) => {
                for (index, repo) in repos.iter().enumerate() {
                    let _ = git_ops::remove_worktree(
                        Path::new(&repo.path),
                        &parent.join(&folders[index]),
                        true,
                    );
                }
                return Err(error);
            }
        };

        self.task_by_id(task_id)?
            .ok_or_else(|| "Task was saved but could not be loaded".into())
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
        let result = rows(stmt
            .query_map(params![task_id], task_repo_from_row)
            .map_err(|error| error.to_string())?);
        result
    }

    pub fn list_tasks(&self, repo_id: Option<i64>) -> Result<Vec<TaskSummary>, String> {
        let sql = "
            SELECT t.id, t.repo_id, t.title, t.prompt, t.status, t.pr_url, t.agent_profile_id, a.name, a.agent_kind,
                   t.has_worktree, t.branch_name, t.worktree_path, t.active_session_id,
                   t.last_session_id, t.last_session_agent, t.last_session_cwd, t.last_session_label,
                   t.created_at, t.updated_at,
                   rl.status,
                   t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url, t.workspace_id,
                   t.attention
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
                    "{sql} WHERE EXISTS (SELECT 1 FROM task_repos tr WHERE tr.task_id = t.id AND tr.repo_id = ?1) ORDER BY t.updated_at DESC"
                ))
                .map_err(|error| error.to_string())?;
            let mapped = rows(stmt
                .query_map(params![repo_id], task_from_row)
                .map_err(|error| error.to_string())?);
            mapped?
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!("{sql} ORDER BY t.updated_at DESC"))
                .map_err(|error| error.to_string())?;
            let mapped = rows(stmt
                .query_map([], task_from_row)
                .map_err(|error| error.to_string())?);
            mapped?
        };
        for task in tasks.iter_mut() {
            task.task_repos = self.task_repos_for(task.id)?;
        }
        Ok(tasks)
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
                       t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url, t.workspace_id,
                       t.attention
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
        // A single task read tolerates the per-worktree `git status` cost inline
        // (the bulk list defers it off-lock); compute it for the task and each repo.
        task.is_dirty = task
            .worktree_path
            .as_ref()
            .is_some_and(|path| git_ops::is_dirty(Path::new(path)));
        task.task_repos = self.task_repos_for(id)?;
        for task_repo in task.task_repos.iter_mut() {
            task_repo.is_dirty = task_repo
                .worktree_path
                .as_ref()
                .is_some_and(|path| git_ops::is_dirty(Path::new(path)));
        }
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

        // Resolve every repo's worktree once (a cross-repo task has several).
        let mut worktrees: Vec<(String, String)> = Vec::new();
        for task_repo in &existing.task_repos {
            if let Some(worktree_path) = &task_repo.worktree_path {
                let repo = self
                    .repo_by_id(task_repo.repo_id)?
                    .ok_or_else(|| "Repository not found".to_string())?;
                worktrees.push((repo.path, worktree_path.clone()));
            }
        }

        // Without `force`, refuse the whole delete if ANY worktree carries
        // uncommitted work — so a multi-repo delete never discards one repo's
        // changes before failing on another. The caller confirms, then retries
        // with force (mirroring the single-repo dialog).
        if !force {
            for (_, worktree_path) in &worktrees {
                if git_ops::is_dirty(Path::new(worktree_path)) {
                    return Err(git_ops::WORKTREE_HAS_CHANGES.to_string());
                }
            }
        }
        // If a removal fails mid-loop for a non-dirty reason (e.g. a locked
        // worktree), earlier repos are already removed and the task row stays —
        // the same multi-step filesystem/DB non-atomicity the single-repo path has.
        // It self-heals: a retry sees the missing worktrees as clean (is_dirty
        // false on a gone path) and remove_worktree short-circuits, completing the
        // delete cleanly.
        for (repo_path, worktree_path) in &worktrees {
            git_ops::remove_worktree(Path::new(repo_path), Path::new(worktree_path), force)?;
        }

        // task_repos rows cascade-delete with the task row.
        self.conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
            .map_err(|error| format!("Failed to delete task: {error}"))?;
        Ok(())
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
        assert_eq!(distinct.len(), 3, "all folders must be distinct: {folders:?}");
        assert_eq!(folders[0], "api-6");
        assert_eq!(folders[1], "api");
    }
}
