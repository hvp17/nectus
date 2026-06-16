mod db;
mod diagnostics;
mod git_ops;
mod github;
mod jira;
mod jira_rest;
mod jira_secret;
mod models;
mod process_util;
mod sessions;

use crate::db::Database;
use crate::models::{
    AcpProviderInfo, AgentProfile, AgentProfileInput, AppError, AppResult, AppSettings,
    AppSettingsInput, ChatCheckpoint, ChatImageAttachment, ChatPermissionPolicy, ChatSession,
    ChatTranscript, GithubStatus, JiraProject, JiraRestStatus, JiraSprintLane, JiraStatusDef,
    JiraTransition, JiraWorkItem, PrReview, PrReviewMode, PrReviewRun, PullRequestInfo, Repo,
    ReviewLoop, ReviewRun, TaskDiffSummary, TaskStatus, TaskSummary, Workspace,
};
use crate::sessions::AcpManager;
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    db: Arc<Mutex<Database>>,
    acp: AcpManager,
}

fn app_result<T>(result: Result<T, String>) -> AppResult<T> {
    result.map_err(Into::into)
}

/// Run blocking work (DB/git/CLI) off the async runtime and flatten the result:
/// maps a `JoinError` to `context` and the inner `Err(String)` to `AppError`.
/// Collapses the `spawn_blocking(...).await.map_err(...)?.map_err(Into::into)`
/// tail repeated across the command layer.
async fn blocking<T, F>(context: &'static str, f: F) -> AppResult<T>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| AppError::from(format!("{context}: {error}")))?
        .map_err(Into::into)
}

#[derive(Debug)]
struct TaskChatContext {
    task: TaskSummary,
    repo: Repo,
    agent: AgentProfile,
}

fn task_chat_context(
    db: &Database,
    task_id: i64,
    agent_profile_id: Option<i64>,
) -> AppResult<TaskChatContext> {
    // DB-only load: ACP chat launch never reads is_dirty, and this runs under the
    // global DB lock, so it must not shell out to `git status`.
    let task = db
        .task_by_id(task_id)?
        .ok_or_else(|| AppError::from("Task not found"))?;
    let agent_profile_id = agent_profile_id
        .or(task.agent_profile_id)
        .ok_or_else(|| AppError::from("Task does not have an agent profile to start chat"))?;
    let repo = db
        .repo_by_id(task.repo_id)?
        .ok_or_else(|| AppError::from("Repository not found"))?;
    let agent = db
        .agent_profile_by_id(agent_profile_id)?
        .ok_or_else(|| AppError::from("Agent profile not found"))?;

    Ok(TaskChatContext { task, repo, agent })
}

// Adding a repo validates it with `git rev-parse` (a subprocess), so run it on
// the blocking pool — and OFF the DB lock; only the insert locks.
#[tauri::command]
async fn add_repo(path: String, state: State<'_, AppState>) -> AppResult<Repo> {
    let db = state.db.clone();
    blocking("Failed to add repository", move || {
        let repo_path = std::fs::canonicalize(&path)
            .map_err(|error| format!("Failed to resolve repository path: {error}"))?;
        git_ops::validate_repo_path(&repo_path)?;
        db.lock().insert_repo(&repo_path)
    })
    .await
}

#[tauri::command]
fn list_repos(state: State<'_, AppState>) -> AppResult<Vec<Repo>> {
    app_result(state.db.lock().list_repos())
}

/// Persist whether the sidebar folds away this project's nested agent list.
#[tauri::command]
fn set_repo_collapsed(id: i64, collapsed: bool, state: State<'_, AppState>) -> AppResult<()> {
    app_result(state.db.lock().set_repo_collapsed(id, collapsed))
}

/// Rename a project's display name (the path and worktree root are untouched).
#[tauri::command]
fn rename_repo(id: i64, name: String, state: State<'_, AppState>) -> AppResult<Repo> {
    app_result(state.db.lock().rename_repo(id, name))
}

/// Remove a project from Nectus. Refuses while tasks reference it; never touches
/// the repository on disk.
#[tauri::command]
fn remove_repo(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    app_result(state.db.lock().remove_repo(id))
}

#[tauri::command]
fn get_app_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    app_result(state.db.lock().get_app_settings())
}

#[tauri::command]
fn update_app_settings(
    settings: AppSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<AppSettings> {
    app_result(state.db.lock().update_app_settings(settings))
}

// The parameter list is the Tauri IPC contract: each field maps 1:1 to the
// `api.ts` `create_task` invoke payload (and is asserted by the frontend tests).
// Folding them into a struct would only nest the same fields under a key, so the
// flat signature is kept deliberately.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn create_task(
    repo_id: i64,
    title: String,
    prompt: Option<String>,
    agent_profile_id: Option<i64>,
    has_worktree: Option<bool>,
    branch_name: Option<String>,
    jira_issue_key: Option<String>,
    jira_issue_summary: Option<String>,
    jira_issue_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    blocking("Failed to create task", move || {
        let has_worktree = has_worktree.unwrap_or(false);
        // The slow part — `git worktree add` + a network `git fetch` — must run
        // OFF the global DB lock so it doesn't stall every other command. We hold
        // the lock only for the fast bits: plan the worktree, then insert the row.
        let task = if has_worktree {
            let (repo, branch, worktree_path) = db.lock().worktree_plan(repo_id, branch_name)?;
            tracing::info!(repo_id, branch = %branch, "create_task: creating worktree off-lock");
            git_ops::create_worktree(Path::new(&repo.path), &worktree_path, &branch)?;
            let worktree_value = worktree_path.to_string_lossy().to_string();
            tracing::info!(
                repo_id,
                "create_task: worktree ready; inserting row (brief lock)"
            );
            db.lock()
                .insert_task(
                    repo_id,
                    title,
                    prompt,
                    agent_profile_id,
                    Some(&branch),
                    Some(&worktree_value),
                )
                .inspect_err(|_| {
                    // Compensate a failed insert (e.g. a re-used branch) by removing
                    // the just-created, app-owned worktree.
                    let _ = git_ops::remove_worktree(Path::new(&repo.path), &worktree_path, true);
                })?
        } else {
            db.lock()
                .insert_task(repo_id, title, prompt, agent_profile_id, None, None)?
        };
        // Attaching to a story only links locally — it never writes back to JIRA.
        if jira_issue_key.is_some() {
            return db.lock().set_task_jira_link(
                task.id,
                jira_issue_key,
                jira_issue_summary,
                jira_issue_url,
            );
        }
        Ok(task)
    })
    .await
}

/// Create a task that spans several repos (Increment B): one worktree per repo as
/// siblings under a shared parent, driven by a single agent session. `repo_ids[0]`
/// is the primary repo (the session's working directory). Accepts the same
/// optional JIRA story link as `create_task`, so a story-seeded task keeps its
/// link regardless of scope.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn create_cross_repo_task(
    workspace_id: Option<i64>,
    repo_ids: Vec<i64>,
    title: String,
    prompt: Option<String>,
    agent_profile_id: Option<i64>,
    branch_name: Option<String>,
    jira_issue_key: Option<String>,
    jira_issue_summary: Option<String>,
    jira_issue_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    blocking("Failed to create cross-repo task", move || {
        // Plan under the lock (fast), create all worktrees off-lock and in
        // parallel (the slow network git), then insert under the lock (fast).
        let plan = db.lock().cross_repo_plan(repo_ids, branch_name, prompt)?;
        tracing::info!(
            repo_count = plan.repos.len(),
            "create_cross_repo_task: creating worktrees off-lock"
        );
        plan.create_worktrees()?;
        tracing::info!("create_cross_repo_task: worktrees ready; inserting rows (brief lock)");
        let task = db
            .lock()
            .insert_cross_repo_task(&plan, workspace_id, title, agent_profile_id)
            .inspect_err(|_| plan.teardown_worktrees())?;
        // Attaching to a story only links locally — it never writes back to JIRA.
        if jira_issue_key.is_some() {
            return db.lock().set_task_jira_link(
                task.id,
                jira_issue_key,
                jira_issue_summary,
                jira_issue_url,
            );
        }
        Ok(task)
    })
    .await
}

/// `archived = true` lists the archive view instead of the live boards.
#[tauri::command]
async fn list_tasks(
    repo_id: Option<i64>,
    archived: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<TaskSummary>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<TaskSummary>, String> {
        let mut tasks = db.lock().list_tasks(repo_id, archived.unwrap_or(false))?;
        // Compute worktree dirtiness off the DB lock: one `git status` per
        // worktree-backed repo, which under the global mutex would otherwise
        // serialize every concurrent command behind the whole board load. For a
        // cross-repo task this checks each repo's worktree.
        for task in tasks.iter_mut() {
            fill_task_dirtiness(task);
        }
        Ok(tasks)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to list tasks: {error}")))?
    .map_err(Into::into)
}

/// Fill in worktree dirtiness — one `git status` subprocess per worktree-backed
/// repo. DB reads never compute this (a subprocess under the global DB lock would
/// stall every other command), so commands returning a task to the UI call this
/// **after releasing the lock**.
fn fill_task_dirtiness(task: &mut TaskSummary) {
    if let Some(path) = task.worktree_path.as_deref() {
        task.is_dirty = git_ops::is_dirty(Path::new(path));
    }
    for task_repo in task.task_repos.iter_mut() {
        if let Some(path) = task_repo.worktree_path.as_deref() {
            task_repo.is_dirty = git_ops::is_dirty(Path::new(path));
        }
    }
}

#[tauri::command]
async fn update_task_metadata(
    task_id: i64,
    title: Option<String>,
    status: Option<TaskStatus>,
    pr_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    blocking("Failed to update task", move || {
        let mut task = db
            .lock()
            .update_task_metadata(task_id, title, status, pr_url)?;
        fill_task_dirtiness(&mut task);
        Ok(task)
    })
    .await
}

/// Archive (or restore) a task: hidden from boards, kept on disk until deleted.
#[tauri::command]
async fn set_task_archived(
    task_id: i64,
    archived: bool,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    blocking("Failed to update task", move || {
        let mut task = db.lock().set_task_archived(task_id, archived)?;
        fill_task_dirtiness(&mut task);
        Ok(task)
    })
    .await
}

#[tauri::command]
async fn delete_task(
    task_id: i64,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = state.db.clone();
    let force = force.unwrap_or(false);
    blocking("Failed to finish task deletion", move || {
        // Plan under the lock (fast), remove worktrees off-lock (the `git`
        // subprocesses — and any all-or-nothing dirty check), then delete the row
        // under a brief lock. Keeps `git worktree remove` off the global DB lock.
        let plan = db.lock().plan_task_deletion(task_id)?;
        plan.remove_worktrees(force)?;
        db.lock().delete_task_row(task_id)
    })
    .await
}

#[tauri::command]
fn list_workspaces(state: State<'_, AppState>) -> AppResult<Vec<Workspace>> {
    app_result(state.db.lock().list_workspaces())
}

#[tauri::command]
fn create_workspace(
    name: String,
    repo_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    app_result(state.db.lock().create_workspace(name, repo_ids))
}

#[tauri::command]
fn update_workspace(
    id: i64,
    name: String,
    repo_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> AppResult<Workspace> {
    app_result(state.db.lock().update_workspace(id, name, repo_ids))
}

#[tauri::command]
fn delete_workspace(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    app_result(state.db.lock().delete_workspace(id))
}

/// Persist whether the sidebar folds away this workspace's nested agent list.
#[tauri::command]
fn set_workspace_collapsed(id: i64, collapsed: bool, state: State<'_, AppState>) -> AppResult<()> {
    app_result(state.db.lock().set_workspace_collapsed(id, collapsed))
}

/// Report whether `gh` is installed, authenticated, and which account is active.
#[tauri::command]
async fn github_status() -> AppResult<GithubStatus> {
    tauri::async_runtime::spawn_blocking(github::status)
        .await
        .map_err(|error| AppError::from(format!("Failed to query GitHub status: {error}")))
}

/// Fetch the live status of the pull request for the task's worktree branch.
/// For a cross-repo task, `repo_id` selects which member repo's branch to
/// inspect (`None` → the primary repo).
#[tauri::command]
async fn github_pull_request_status(
    task_id: i64,
    repo_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<PullRequestInfo> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<PullRequestInfo, String> {
        let worktree = {
            let db = db.lock();
            let task = db
                .task_by_id(task_id)?
                .ok_or_else(|| "Task not found".to_string())?;
            task_repo_worktree(&task, repo_id)?
        };
        github::pull_request_status(Path::new(&worktree))
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load pull request status: {error}")))?
    .map_err(Into::into)
}

/// Detect a pull request already open for the task's worktree branch (e.g. one
/// opened from the terminal) and backfill its URL. Returns the updated task when a
/// PR was found and linked, or `None` when the branch has no PR yet. For a
/// cross-repo task, `repo_id` selects the member repo: the primary repo's PR
/// lands on `tasks.pr_url`, a non-primary repo's on its `task_repos.pr_url`.
#[tauri::command]
async fn detect_github_pull_request(
    task_id: i64,
    repo_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Option<TaskSummary>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<TaskSummary>, String> {
        let (worktree, target_repo_id, is_primary) = {
            let db = db.lock();
            let task = db
                .task_by_id(task_id)?
                .ok_or_else(|| "Task not found".to_string())?;
            let target_repo_id = repo_id.unwrap_or(task.repo_id);
            let is_primary = target_repo_id == task.repo_id;
            // Nothing to detect once that repo's PR is linked, or without a
            // worktree branch.
            let already_linked = if is_primary {
                task.pr_url.is_some()
            } else {
                task.task_repos
                    .iter()
                    .find(|task_repo| task_repo.repo_id == target_repo_id)
                    .is_some_and(|task_repo| task_repo.pr_url.is_some())
            };
            if already_linked || !task.has_worktree {
                return Ok(None);
            }
            (
                task_repo_worktree(&task, repo_id)?,
                target_repo_id,
                is_primary,
            )
        };
        match github::find_pull_request(Path::new(&worktree))? {
            Some(info) => {
                let mut task = if is_primary {
                    db.lock()
                        .update_task_metadata(task_id, None, None, Some(info.url))?
                } else {
                    db.lock()
                        .set_task_repo_pr_url(task_id, target_repo_id, &info.url)?
                };
                fill_task_dirtiness(&mut task);
                Ok(Some(task))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to detect pull request: {error}")))?
    .map_err(Into::into)
}

/// Post a finished PR review back to its pull request as a comment. The review
/// must be `ready` with output; the body carries a short automated-attribution
/// header so it is not mistaken for a human review.
#[tauri::command]
async fn post_pr_review_comment(review_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let (repo_path, pr_number, body) = {
            let db = db.lock();
            let review = db
                .pr_review_by_id(review_id)?
                .ok_or_else(|| "PR review not found".to_string())?;
            let output = review
                .review_output
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| "This review has no output to post yet".to_string())?;
            let repo = db
                .repo_by_id(review.repo_id)?
                .ok_or_else(|| "Repository not found".to_string())?;
            let body = format!(
                "🤖 Automated review via Nectus ({reviewer})\n\n{output}",
                reviewer = review.reviewer_name.as_deref().unwrap_or("AI reviewer"),
            );
            (repo.path, review.pr_number, body)
        };
        github::comment_on_pull_request(Path::new(&repo_path), pr_number, &body)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to post review comment: {error}")))?
    .map_err(Into::into)
}

/// Resolve the working directory a task's diff is computed in, plus whether it is a
/// worktree task. Worktree tasks diff against their branch base; direct-edit tasks
/// diff the working tree against `HEAD`. For a cross-repo task, `repo_id` selects
/// which member repo's worktree to target (`None` → the primary repo).
fn task_diff_target(
    db: &Database,
    task_id: i64,
    repo_id: Option<i64>,
) -> Result<(String, bool), String> {
    let task = db
        .task_by_id(task_id)?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.has_worktree {
        let path = task_repo_worktree(&task, repo_id)?;
        Ok((path, true))
    } else {
        let repo = db
            .repo_by_id(task.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        Ok((repo.path, false))
    }
}

/// The worktree path for one of a task's member repos (`None` → the primary).
/// Every worktree task has a `task_repos` row per member, each with its own
/// sibling worktree, so the per-repo Diff/GitHub surfaces can target any of them.
fn task_repo_worktree(task: &TaskSummary, repo_id: Option<i64>) -> Result<String, String> {
    let repo_id = repo_id.unwrap_or(task.repo_id);
    if repo_id == task.repo_id {
        return task
            .worktree_path
            .clone()
            .ok_or_else(|| "Task has no worktree branch to inspect".to_string());
    }
    task.task_repos
        .iter()
        .find(|task_repo| task_repo.repo_id == repo_id)
        .and_then(|task_repo| task_repo.worktree_path.clone())
        .ok_or_else(|| "Task has no worktree for that repository".to_string())
}

/// Summarize the files a task changed: its branch vs the base branch for worktree
/// tasks, or the working tree vs `HEAD` for direct-edit tasks.
#[tauri::command]
async fn task_diff_summary(
    task_id: i64,
    repo_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<TaskDiffSummary> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<TaskDiffSummary, String> {
        let (path, has_worktree) = {
            let db = db.lock();
            task_diff_target(&db, task_id, repo_id)?
        };
        let path = Path::new(&path);
        let base = if has_worktree {
            git_ops::resolve_diff_base(path)
        } else {
            None
        };
        let files = git_ops::diff_summary(path, base.as_ref().map(|base| base.commit.as_str()))?;
        Ok(TaskDiffSummary {
            base_label: base.map(|base| base.label),
            files,
        })
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load task diff: {error}")))?
    .map_err(Into::into)
}

/// Return the unified patch for one file in a task's diff (lazy-loaded per file).
#[tauri::command]
async fn task_diff_file(
    task_id: i64,
    repo_id: Option<i64>,
    file: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let (path, has_worktree) = {
            let db = db.lock();
            task_diff_target(&db, task_id, repo_id)?
        };
        let path = Path::new(&path);
        let base = if has_worktree {
            git_ops::resolve_diff_base(path)
        } else {
            None
        };
        git_ops::diff_file(path, base.as_ref().map(|base| base.commit.as_str()), &file)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load file diff: {error}")))?
    .map_err(Into::into)
}

/// List the JIRA projects visible to the user, for the board's project picker
/// (`GET /project/search`).
#[tauri::command]
async fn jira_list_projects(state: State<'_, AppState>) -> AppResult<Vec<JiraProject>> {
    jira_rest_call(
        &state,
        "Failed to list JIRA projects",
        |site, email, token| jira_rest::list_projects(&site, &email, &token),
    )
    .await
}

/// Load the JIRA board. The JQL is built from the structured board config (project
/// + filter toggles) so the user never types JQL.
#[tauri::command]
async fn jira_search_board(state: State<'_, AppState>) -> AppResult<Vec<JiraWorkItem>> {
    let jql = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        let project = settings
            .jira_board_project
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::from("Choose a JIRA project to load the board"))?;
        jira::build_board_jql(
            &project,
            settings.jira_filter_my_issues,
            settings.jira_filter_unresolved,
            settings.jira_filter_current_sprint,
            &settings.jira_filter_statuses,
            settings.jira_filter_epic.as_deref(),
        )
    };
    jira_rest_call(
        &state,
        "Failed to load JIRA board",
        move |site, email, token| jira_rest::search(&site, &email, &token, &jql, 200),
    )
    .await
}

/// List a project's epics, to populate the board's epic-filter picker.
#[tauri::command]
async fn jira_list_epics(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<JiraWorkItem>> {
    let jql = jira::build_epics_jql(&project);
    jira_rest_call(
        &state,
        "Failed to list JIRA epics",
        move |site, email, token| jira_rest::search(&site, &email, &token, &jql, 200),
    )
    .await
}

/// Fetch a single work item (e.g. to backfill a story description on attach).
#[tauri::command]
async fn jira_get_work_item(state: State<'_, AppState>, key: String) -> AppResult<JiraWorkItem> {
    jira_rest_call(
        &state,
        "Failed to load work item",
        move |site, email, token| jira_rest::view(&site, &email, &token, &key),
    )
    .await
}

/// Transition a work item: resolve the target status name to one of the issue's
/// **legal** transitions and POST it. A workflow-forbidden move errors and the UI
/// reverts the card.
#[tauri::command]
async fn jira_transition_work_item(
    state: State<'_, AppState>,
    key: String,
    status: String,
) -> AppResult<()> {
    jira_rest_call(
        &state,
        "Failed to transition work item",
        move |site, email, token| {
            jira_rest::transition_to_status(&site, &email, &token, &key, &status)
        },
    )
    .await
}

/// Assign a work item, resolving the assignee (`@me`, email, or display name) to
/// an account id first.
#[tauri::command]
async fn jira_assign_work_item(
    state: State<'_, AppState>,
    key: String,
    assignee: String,
) -> AppResult<()> {
    jira_rest_call(
        &state,
        "Failed to assign work item",
        move |site, email, token| jira_rest::assign(&site, &email, &token, &key, &assignee),
    )
    .await
}

#[tauri::command]
async fn jira_comment_work_item(
    state: State<'_, AppState>,
    key: String,
    body: String,
) -> AppResult<()> {
    jira_rest_call(
        &state,
        "Failed to comment on work item",
        move |site, email, token| jira_rest::comment(&site, &email, &token, &key, &body),
    )
    .await
}

/// Create a JIRA work item from the board's structured form, returning the new
/// item (re-fetched so it carries status/type for the board panel). Optional
/// fields are passed through only when present.
#[tauri::command]
async fn jira_create_work_item(
    state: State<'_, AppState>,
    project: String,
    issue_type: String,
    summary: String,
    description: Option<String>,
    assignee: Option<String>,
    labels: Option<String>,
) -> AppResult<JiraWorkItem> {
    jira_rest_call(
        &state,
        "Failed to create work item",
        move |site, email, token| {
            jira_rest::create(
                &site,
                &email,
                &token,
                &project,
                &issue_type,
                &summary,
                description.as_deref(),
                assignee.as_deref(),
                labels.as_deref().unwrap_or(""),
            )
        },
    )
    .await
}

/// Run a JIRA REST operation on the blocking pool with the connected token's
/// credentials. Errors immediately when no token is connected — the API token is
/// the JIRA connection (Settings → JIRA).
async fn jira_rest_call<T>(
    state: &State<'_, AppState>,
    context: &'static str,
    f: impl FnOnce(String, String, String) -> Result<T, String> + Send + 'static,
) -> AppResult<T>
where
    T: Send + 'static,
{
    let (site, email, token) = rest_credentials(state)?;
    blocking(context, move || f(site, email, token)).await
}

/// Resolve `(site, email, token)` for a REST call, or an error when not connected.
fn rest_credentials(state: &State<'_, AppState>) -> Result<(String, String, String), AppError> {
    let (site, email) = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        (settings.jira_site_url, settings.jira_rest_email)
    };
    let site = site
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    let email = email
        .filter(|e| !e.trim().is_empty())
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    let token = jira_secret::read_token(&site)?
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    Ok((site, email, token))
}

/// REST connection state: a token is "connected" when the Keychain holds one for
/// the configured site and an email is set.
#[tauri::command]
fn jira_rest_status(state: State<'_, AppState>) -> AppResult<JiraRestStatus> {
    let (site, email) = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        (settings.jira_site_url, settings.jira_rest_email)
    };
    let Some(site) = site.filter(|s| !s.trim().is_empty()) else {
        return Ok(JiraRestStatus {
            connected: false,
            site: None,
            email,
            error: None,
        });
    };
    let has_token = jira_secret::read_token(&site)?.is_some();
    Ok(JiraRestStatus {
        connected: has_token && email.is_some(),
        site: Some(site),
        email,
        error: None,
    })
}

/// Verify a token via `GET /myself`, then store it in the Keychain and persist the
/// non-secret site/email. Stores nothing on failure.
#[tauri::command]
async fn set_jira_api_token(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> AppResult<JiraRestStatus> {
    let (site, email) = (site.trim().to_string(), email.trim().to_string());
    if site.is_empty() || email.is_empty() || token.is_empty() {
        return Err(AppError::from("Site, email, and token are all required"));
    }
    let verify = {
        let (s, e, t) = (site.clone(), email.clone(), token.clone());
        tauri::async_runtime::spawn_blocking(move || jira_rest::verify(&s, &e, &t))
            .await
            .map_err(|error| AppError::from(format!("Failed to verify JIRA token: {error}")))?
    };
    verify.map_err(AppError::from)?;
    jira_secret::store_token(&site, &token).map_err(AppError::from)?;
    {
        let db = state.db.lock();
        db.set_jira_rest_account(&site, &email)?;
    }
    Ok(JiraRestStatus {
        connected: true,
        site: Some(site),
        email: Some(email),
        error: None,
    })
}

/// Disconnect the REST token: delete it from the Keychain, then clear the stored
/// email. The Keychain delete runs first so a delete failure aborts before the
/// email is cleared — leaving a consistent "still connected" state rather than an
/// orphaned token with no email.
#[tauri::command]
fn clear_jira_api_token(state: State<'_, AppState>) -> AppResult<()> {
    let site = {
        let db = state.db.lock();
        db.get_app_settings()?.jira_site_url
    };
    if let Some(site) = site.filter(|s| !s.trim().is_empty()) {
        jira_secret::delete_token(&site).map_err(AppError::from)?;
    }
    state.db.lock().clear_jira_rest_email()?;
    Ok(())
}

/// List an issue's legal transitions (for the work-item status dropdown).
#[tauri::command]
async fn jira_list_transitions(
    state: State<'_, AppState>,
    key: String,
) -> AppResult<Vec<JiraTransition>> {
    jira_rest_call(
        &state,
        "Failed to list transitions",
        move |site, email, token| jira_rest::list_transitions(&site, &email, &token, &key),
    )
    .await
}

/// Load a project's full status set (for the board filter + empty columns).
#[tauri::command]
async fn jira_project_statuses(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<JiraStatusDef>> {
    jira_rest_call(
        &state,
        "Failed to load project statuses",
        move |site, email, token| jira_rest::project_statuses(&site, &email, &token, &project),
    )
    .await
}

/// Load the sprint board (active/future sprints + backlog, issues carrying their
/// epic) via the Agile REST API.
#[tauri::command]
async fn jira_sprint_board(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<JiraSprintLane>> {
    jira_rest_call(
        &state,
        "Failed to load sprint board",
        move |site, email, token| jira_rest::sprint_board(&site, &email, &token, &project),
    )
    .await
}

/// Set or clear the local JIRA story link on a task. Never writes to JIRA.
#[tauri::command]
async fn set_task_jira_link(
    task_id: i64,
    key: Option<String>,
    summary: Option<String>,
    url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    blocking("Failed to update JIRA link", move || {
        let mut task = db.lock().set_task_jira_link(task_id, key, summary, url)?;
        fill_task_dirtiness(&mut task);
        Ok(task)
    })
    .await
}

/// Largest consensus round count a caller can request. Each round runs every
/// reviewer once, so this bounds both wall-clock time and token spend.
const MAX_CONSENSUS_ROUNDS: i64 = 5;

/// Start a review of an external pull request: resolve its `owner/repo` to a
/// known project, queue the review, and kick off the background reviewer. One
/// reviewer runs the original single-reviewer flow; two or more runs a
/// multi-model consensus that iterates up to `max_rounds` (default 3) rounds.
// Async because resolving the PR's `owner/repo` to a known project runs one
// `git remote get-url` subprocess per candidate repo — off the main UI thread,
// and off the DB lock (only the repo list and the insert hold it briefly).
#[tauri::command]
async fn create_pr_review(
    pr_url: String,
    reviewer_profile_ids: Option<Vec<i64>>,
    max_rounds: Option<i64>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PrReview> {
    let db = state.db.clone();
    let review = blocking("Failed to create PR review", move || {
        let parsed = github::parse_pull_request_url(&pr_url)?;
        // Brief lock for the candidate list, then match remotes off-lock.
        let repos = db.lock().list_repos()?;
        let repo = github::resolve_repo_for_owner_repo(repos, &parsed.owner, &parsed.repo)
            .ok_or_else(|| {
                format!(
                    "Add {}/{} as a project to review its pull requests",
                    parsed.owner, parsed.repo
                )
            })?;

        let db = db.lock();
        // Fall back to the default reviewer profile when none were chosen, and
        // drop duplicates so consensus runs across distinct reviewers.
        let mut reviewer_ids = reviewer_profile_ids.unwrap_or_default();
        reviewer_ids.retain(|id| *id > 0);
        let mut seen = std::collections::HashSet::new();
        reviewer_ids.retain(|id| seen.insert(*id));
        if reviewer_ids.is_empty() {
            reviewer_ids.push(
                db.get_app_settings()?
                    .default_agent_profile_id
                    .ok_or_else(|| "Choose a reviewer profile for the review".to_string())?,
            );
        }

        // One reviewer → single review; two or more → a consensus review whose
        // first selected reviewer doubles as the synthesizer. The stored `mode`
        // then drives the runtime dispatch (here and on re-run).
        if reviewer_ids.len() <= 1 {
            db.create_pr_review(repo.id, reviewer_ids[0], pr_url.trim(), parsed.number)
        } else {
            let rounds = max_rounds.unwrap_or(3).clamp(1, MAX_CONSENSUS_ROUNDS);
            db.create_consensus_pr_review(
                repo.id,
                reviewer_ids[0],
                &reviewer_ids,
                rounds,
                pr_url.trim(),
                parsed.number,
            )
        }
    })
    .await?;

    start_pr_review(&state, app, review.mode, review.id);
    Ok(review)
}

/// Kick off the background reviewer matching a review's mode. The single/consensus
/// dispatch lives here once, shared by `create_pr_review` and `rerun_pr_review`.
fn start_pr_review(state: &AppState, app: tauri::AppHandle, mode: PrReviewMode, review_id: i64) {
    match mode {
        PrReviewMode::Consensus => {
            sessions::spawn_consensus_pr_review(app, state.db.clone(), review_id)
        }
        PrReviewMode::Single => sessions::spawn_pr_review(app, state.db.clone(), review_id),
    }
}

#[tauri::command]
fn list_pr_reviews(state: State<'_, AppState>) -> AppResult<Vec<PrReview>> {
    app_result(state.db.lock().list_pr_reviews())
}

#[tauri::command]
fn get_pr_review(review_id: i64, state: State<'_, AppState>) -> AppResult<Option<PrReview>> {
    app_result(state.db.lock().pr_review_by_id(review_id))
}

/// The per-reviewer, per-round outputs of a consensus review (empty for a
/// single-reviewer review).
#[tauri::command]
fn list_pr_review_runs(review_id: i64, state: State<'_, AppState>) -> AppResult<Vec<PrReviewRun>> {
    app_result(state.db.lock().list_pr_review_runs(review_id))
}

/// Re-run a finished review: re-fetch the PR head (picking up new commits) and
/// review again, using the same single/consensus mode it was created with.
#[tauri::command]
fn rerun_pr_review(
    review_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PrReview> {
    let review = app_result(state.db.lock().reset_pr_review_for_rerun(review_id))?;
    start_pr_review(&state, app, review.mode, review.id);
    Ok(review)
}

#[tauri::command]
async fn delete_pr_review(review_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // Resolve the worktree/repo paths under a short lock, then remove the
        // worktree (a `git worktree remove` subprocess) off the lock so it can't
        // block other DB commands.
        let cleanup = {
            let db = db.lock();
            match db.pr_review_by_id(review_id)? {
                Some(review) => match (review.worktree_path, db.repo_by_id(review.repo_id)?) {
                    (Some(worktree), Some(repo)) => Some((repo.path, worktree)),
                    _ => None,
                },
                None => None,
            }
        };
        if let Some((repo_path, worktree)) = cleanup {
            // The PR-review worktree is an app-owned ephemeral checkout of the PR
            // head, not user work, so it is always safe to force-remove. Warn on
            // failure rather than silently orphaning it.
            if let Err(error) =
                git_ops::remove_worktree(Path::new(&repo_path), Path::new(&worktree), true)
            {
                tracing::warn!(
                    ?error,
                    review_id,
                    "failed to remove PR review worktree on delete"
                );
            }
        }
        db.lock().delete_pr_review(review_id)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to delete PR review: {error}")))?
    .map_err(Into::into)
}

#[tauri::command]
fn list_agent_profiles(state: State<'_, AppState>) -> AppResult<Vec<AgentProfile>> {
    app_result(state.db.lock().list_agent_profiles())
}

#[tauri::command]
fn list_acp_providers() -> Vec<AcpProviderInfo> {
    sessions::acp_provider_infos()
}

#[tauri::command]
fn upsert_agent_profile(
    profile: AgentProfileInput,
    state: State<'_, AppState>,
) -> AppResult<AgentProfile> {
    app_result(state.db.lock().upsert_agent_profile(profile))
}

#[tauri::command]
fn start_pair_loop(
    task_id: i64,
    reviewer_profile_id: i64,
    state: State<'_, AppState>,
) -> AppResult<ReviewLoop> {
    app_result(
        state
            .db
            .lock()
            .start_review_loop(task_id, reviewer_profile_id),
    )
}

#[tauri::command]
fn run_pair_review(
    task_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ReviewLoop> {
    let review_loop = state
        .db
        .lock()
        .review_loop_by_task_id(task_id)?
        .ok_or_else(|| "Start a review before running the reviewer".to_string())?;
    if review_loop.status != crate::models::ReviewLoopStatus::Running {
        return Err(format!(
            "Review loop is not ready to run: {}",
            review_loop.status.as_str()
        )
        .into());
    }
    let cwd = {
        let task = state
            .db
            .lock()
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        task.worktree_path
            .or_else(|| {
                task.task_repos
                    .first()
                    .and_then(|repo| repo.worktree_path.clone())
            })
            .or_else(|| {
                state
                    .db
                    .lock()
                    .repo_by_id(task.repo_id)
                    .ok()
                    .flatten()
                    .map(|repo| repo.path)
            })
            .ok_or_else(|| "Task has no repository path to review".to_string())?
    };
    sessions::spawn_task_review(app, state.db.clone(), task_id, cwd.into());
    Ok(review_loop)
}

#[tauri::command]
fn stop_pair_loop(task_id: i64, state: State<'_, AppState>) -> AppResult<ReviewLoop> {
    app_result(state.db.lock().stop_review_loop(task_id))
}

#[tauri::command]
fn get_task_review_loop(task_id: i64, state: State<'_, AppState>) -> AppResult<Option<ReviewLoop>> {
    app_result(state.db.lock().review_loop_by_task_id(task_id))
}

#[tauri::command]
fn list_task_review_runs(task_id: i64, state: State<'_, AppState>) -> AppResult<Vec<ReviewRun>> {
    app_result(state.db.lock().list_review_runs(task_id))
}

// ---- ACP embedded chat -------------------------------------------------------

#[tauri::command]
async fn acp_start_chat(
    app: AppHandle,
    task_id: i64,
    agent_profile_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ChatSession> {
    let context = {
        let db = state.db.lock();
        task_chat_context(&db, task_id, agent_profile_id)?
    };
    let db = state.db.clone();
    let acp = state.acp.clone();
    app_result(
        acp.start(app, db, context.task, context.repo, context.agent)
            .await,
    )
}

#[tauri::command]
async fn acp_send_prompt(
    session_id: String,
    text: String,
    images: Option<Vec<ChatImageAttachment>>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // The connection loop persists+emits the user turn (in order with the agent
    // reply) — this just queues the prompt.
    let acp = state.acp.clone();
    app_result(
        acp.prompt(&session_id, text, images.unwrap_or_default())
            .await,
    )
}

#[tauri::command]
async fn acp_respond_permission(
    session_id: String,
    request_id: String,
    option_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let acp = state.acp.clone();
    app_result(
        acp.respond_permission(&session_id, &request_id, option_id)
            .await,
    )
}

#[tauri::command]
async fn acp_stop_chat(session_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let acp = state.acp.clone();
    app_result(acp.stop(&session_id).await)
}

#[tauri::command]
fn get_task_chat(
    task_id: i64,
    agent_profile_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<ChatTranscript> {
    app_result(state.db.lock().chat_transcript(task_id, agent_profile_id))
}

#[tauri::command]
fn list_chat_permission_policies(
    state: State<'_, AppState>,
) -> AppResult<Vec<ChatPermissionPolicy>> {
    app_result(state.db.lock().list_chat_permission_policies())
}

#[tauri::command]
fn clear_chat_permission_policies(state: State<'_, AppState>) -> AppResult<()> {
    app_result(state.db.lock().clear_chat_permission_policies())
}

#[tauri::command]
fn list_chat_checkpoints(
    chat_session_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ChatCheckpoint>> {
    app_result(state.db.lock().list_chat_checkpoints(&chat_session_id))
}

#[tauri::command]
async fn restore_chat_checkpoint(
    checkpoint_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (worktree_path, commit) = {
        let db = state.db.lock();
        let checkpoint = db
            .chat_checkpoint_by_id(&checkpoint_id)?
            .ok_or_else(|| AppError::from("Checkpoint not found"))?;
        let task = db
            .task_by_id(checkpoint.task_id)?
            .ok_or_else(|| AppError::from("Task not found"))?;
        let repo = db
            .repo_by_id(task.repo_id)?
            .ok_or_else(|| AppError::from("Repository not found"))?;
        let path = task
            .worktree_path
            .clone()
            .unwrap_or_else(|| repo.path.clone());
        (path, checkpoint.git_commit)
    };
    blocking("Failed to restore chat checkpoint", move || {
        git_ops::restore_chat_checkpoint(Path::new(&worktree_path), &commit)
    })
    .await
}

pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Stream captured log lines to the UI from here on; earlier lines stay
            // in the buffer and are backfilled when the panel first opens.
            diagnostics::attach_app_handle(app.handle().clone());
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Failed to find app data directory: {error}"))?;
            tracing::info!(path = %data_dir.display(), "opening app data directory");
            let db = Database::open(data_dir.join("nectus.sqlite3"))?;
            db.clear_legacy_active_sessions()?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                acp: AcpManager::new(),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(state) = window.try_state::<AppState>() {
                    state.acp.stop_all_blocking();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            add_repo,
            list_repos,
            set_repo_collapsed,
            rename_repo,
            remove_repo,
            get_app_settings,
            update_app_settings,
            create_task,
            create_cross_repo_task,
            list_tasks,
            update_task_metadata,
            set_task_archived,
            delete_task,
            list_workspaces,
            create_workspace,
            update_workspace,
            delete_workspace,
            set_workspace_collapsed,
            task_diff_summary,
            task_diff_file,
            github_status,
            github_pull_request_status,
            detect_github_pull_request,
            post_pr_review_comment,
            jira_list_projects,
            jira_search_board,
            jira_list_epics,
            jira_get_work_item,
            jira_transition_work_item,
            jira_assign_work_item,
            jira_comment_work_item,
            jira_create_work_item,
            jira_rest_status,
            set_jira_api_token,
            clear_jira_api_token,
            jira_list_transitions,
            jira_project_statuses,
            jira_sprint_board,
            set_task_jira_link,
            create_pr_review,
            list_pr_reviews,
            get_pr_review,
            list_pr_review_runs,
            rerun_pr_review,
            delete_pr_review,
            list_acp_providers,
            list_agent_profiles,
            upsert_agent_profile,
            start_pair_loop,
            run_pair_review,
            stop_pair_loop,
            get_task_review_loop,
            list_task_review_runs,
            get_diagnostic_logs,
            acp_start_chat,
            acp_send_prompt,
            acp_respond_permission,
            acp_stop_chat,
            get_task_chat,
            list_chat_permission_policies,
            clear_chat_permission_policies,
            list_chat_checkpoints,
            restore_chat_checkpoint
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("nectus_desktop_lib=info"));
    // Two sinks behind one filter: the usual console output, plus an in-memory
    // buffer the Diagnostics panel reads/streams (ANSI off so the UI shows plain
    // text). Both see exactly the lines that reach the console.
    let stdout_layer = tracing_subscriber::fmt::layer().with_target(false);
    let buffer_layer = tracing_subscriber::fmt::layer()
        .with_target(false)
        .with_ansi(false)
        .with_writer(diagnostics::DiagnosticsWriter);
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(buffer_layer)
        .try_init();
}

/// Return the buffered diagnostics log lines (oldest first) so a freshly opened
/// panel can backfill before live `diagnostic_log` events take over. Reads the
/// dedicated diagnostics buffer, never the DB lock, so it stays responsive even
/// while a DB-bound command is stuck.
#[tauri::command]
fn get_diagnostic_logs() -> Vec<String> {
    diagnostics::buffered_logs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AgentKind;
    use tempfile::tempdir;

    fn add_temp_repo(db: &Database) -> Repo {
        let repo_dir = tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        db.add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap()
    }

    #[test]
    fn task_chat_context_loads_task_repo_and_explicit_agent() {
        let db = Database::open_in_memory().unwrap();
        let repo = add_temp_repo(&db);
        let profiles = db.list_agent_profiles().unwrap();
        let claude = profiles
            .iter()
            .find(|profile| profile.agent_kind == AgentKind::Claude)
            .unwrap();
        let task = db
            .create_task_record(repo.id, "Run agent".to_string(), None, None, false, None)
            .unwrap();

        let context = task_chat_context(&db, task.id, Some(claude.id)).unwrap();

        assert_eq!(context.task.id, task.id);
        assert_eq!(context.repo.id, repo.id);
        assert_eq!(context.agent.id, claude.id);
    }

    #[test]
    fn task_chat_context_uses_stored_agent_for_start() {
        let db = Database::open_in_memory().unwrap();
        let repo = add_temp_repo(&db);
        let codex = db.list_agent_profiles().unwrap()[0].clone();
        let task = db
            .create_task_record(
                repo.id,
                "Resume agent".to_string(),
                None,
                Some(codex.id),
                false,
                None,
            )
            .unwrap();

        let context = task_chat_context(&db, task.id, None).unwrap();

        assert_eq!(context.agent.id, codex.id);
    }

    #[test]
    fn task_chat_context_requires_an_agent_for_start() {
        let db = Database::open_in_memory().unwrap();
        let repo = add_temp_repo(&db);
        let task = db
            .create_task_record(repo.id, "Resume agent".to_string(), None, None, false, None)
            .unwrap();

        let error = task_chat_context(&db, task.id, None).unwrap_err();

        assert_eq!(
            error.to_string(),
            "Task does not have an agent profile to start chat"
        );
    }
}
