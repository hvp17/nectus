mod db;
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
    AgentKind, AgentProfile, AgentProfileInput, AppError, AppResult, AppSettings, AppSettingsInput,
    GithubStatus, JiraProject, JiraRestStatus, JiraStatus, JiraStatusDef, JiraTransition,
    JiraWorkItem, PrReview, PrReviewMode, PrReviewRun, PullRequestInfo, Repo, ReviewLoop, ReviewRun,
    Session, SessionExitedEvent, SessionOutputSnapshot, TaskDiffSummary, TaskStatus, TaskSummary,
};
use crate::sessions::SessionManager;
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tracing_subscriber::EnvFilter;

pub struct AppState {
    db: Arc<Mutex<Database>>,
    sessions: SessionManager,
}

fn app_result<T>(result: Result<T, String>) -> AppResult<T> {
    result.map_err(Into::into)
}

#[derive(Debug)]
struct TaskSessionContext {
    task: TaskSummary,
    repo: Repo,
    agent: AgentProfile,
}

fn task_session_context(
    db: &Database,
    task_id: i64,
    agent_profile_id: Option<i64>,
) -> AppResult<TaskSessionContext> {
    let task = db
        .task_by_id(task_id)?
        .ok_or_else(|| AppError::from("Task not found"))?;
    let agent_profile_id = agent_profile_id
        .or(task.agent_profile_id)
        .ok_or_else(|| AppError::from("Task does not have an agent profile to resume"))?;
    let repo = db
        .repo_by_id(task.repo_id)?
        .ok_or_else(|| AppError::from("Repository not found"))?;
    let agent = db
        .agent_profile_by_id(agent_profile_id)?
        .ok_or_else(|| AppError::from("Agent profile not found"))?;

    Ok(TaskSessionContext { task, repo, agent })
}

#[tauri::command]
fn add_repo(path: String, state: State<'_, AppState>) -> AppResult<Repo> {
    app_result(state.db.lock().add_repo(path))
}

#[tauri::command]
fn list_repos(state: State<'_, AppState>) -> AppResult<Vec<Repo>> {
    app_result(state.db.lock().list_repos())
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
    // Worktree creation (`git worktree add`, even a `git fetch`) runs here, so
    // do it on a blocking thread rather than under the async runtime, mirroring
    // delete_task and keeping the symmetric create/delete paths consistent.
    tauri::async_runtime::spawn_blocking(move || -> Result<TaskSummary, String> {
        let db = db.lock();
        let task = db.create_task_record(
            repo_id,
            title,
            prompt,
            agent_profile_id,
            has_worktree.unwrap_or(false),
            branch_name,
        )?;
        // Attaching to a story only links locally — it never writes back to JIRA.
        if jira_issue_key.is_some() {
            return db.set_task_jira_link(
                task.id,
                jira_issue_key,
                jira_issue_summary,
                jira_issue_url,
            );
        }
        Ok(task)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to create task: {error}")))?
    .map_err(Into::into)
}

#[tauri::command]
async fn list_tasks(
    repo_id: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<TaskSummary>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<TaskSummary>, String> {
        let mut tasks = db.lock().list_tasks(repo_id)?;
        // Compute worktree dirtiness off the DB lock: one `git status` per
        // worktree-backed task, which under the global mutex would otherwise
        // serialize every concurrent command behind the whole board load.
        for task in tasks.iter_mut() {
            if let Some(path) = task.worktree_path.as_deref() {
                task.is_dirty = git_ops::is_dirty(Path::new(path));
            }
        }
        Ok(tasks)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to list tasks: {error}")))?
    .map_err(Into::into)
}

#[tauri::command]
fn update_task_metadata(
    task_id: i64,
    title: Option<String>,
    status: Option<TaskStatus>,
    pr_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    app_result(
        state
            .db
            .lock()
            .update_task_metadata(task_id, title, status, pr_url),
    )
}

#[tauri::command]
async fn delete_task(
    task_id: i64,
    force: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let db = state.db.clone();
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || db.lock().delete_task(task_id, force))
        .await
        .map_err(|error| AppError::from(format!("Failed to finish task deletion: {error}")))?
        .map_err(Into::into)
}

/// Report whether `gh` is installed, authenticated, and which account is active.
#[tauri::command]
async fn github_status() -> AppResult<GithubStatus> {
    tauri::async_runtime::spawn_blocking(github::status)
        .await
        .map_err(|error| AppError::from(format!("Failed to query GitHub status: {error}")))
}

/// Open a pull request for the task's worktree branch and persist the PR URL.
#[tauri::command]
async fn create_github_pull_request(
    task_id: i64,
    title: String,
    body: String,
    draft: bool,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<TaskSummary, String> {
        let worktree = {
            let db = db.lock();
            let task = db
                .task_by_id(task_id)?
                .ok_or_else(|| "Task not found".to_string())?;
            task.worktree_path.ok_or_else(|| {
                "Task has no worktree branch to open a pull request from".to_string()
            })?
        };
        let url = github::create_pull_request(Path::new(&worktree), &title, &body, draft)?;
        db.lock()
            .update_task_metadata(task_id, None, None, Some(url))
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to create pull request: {error}")))?
    .map_err(Into::into)
}

/// Fetch the live status of the pull request for the task's worktree branch.
#[tauri::command]
async fn github_pull_request_status(
    task_id: i64,
    state: State<'_, AppState>,
) -> AppResult<PullRequestInfo> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<PullRequestInfo, String> {
        let worktree = {
            let db = db.lock();
            let task = db
                .task_by_id(task_id)?
                .ok_or_else(|| "Task not found".to_string())?;
            task.worktree_path
                .ok_or_else(|| "Task has no worktree branch to inspect".to_string())?
        };
        github::pull_request_status(Path::new(&worktree))
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load pull request status: {error}")))?
    .map_err(Into::into)
}

/// Detect a pull request already open for the task's worktree branch (e.g. one
/// opened from the terminal) and backfill its URL. Returns the updated task when a
/// PR was found and linked, or `None` when the branch has no PR yet.
#[tauri::command]
async fn detect_github_pull_request(
    task_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Option<TaskSummary>> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<TaskSummary>, String> {
        let worktree = {
            let db = db.lock();
            let task = db
                .task_by_id(task_id)?
                .ok_or_else(|| "Task not found".to_string())?;
            // Nothing to detect once a PR is linked, or without a worktree branch.
            match task.worktree_path {
                Some(path) if task.pr_url.is_none() => path,
                _ => return Ok(None),
            }
        };
        match github::find_pull_request(Path::new(&worktree))? {
            Some(info) => db
                .lock()
                .update_task_metadata(task_id, None, None, Some(info.url))
                .map(Some),
            None => Ok(None),
        }
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to detect pull request: {error}")))?
    .map_err(Into::into)
}

/// Resolve the working directory a task's diff is computed in, plus whether it is a
/// worktree task. Worktree tasks diff against their branch base; direct-edit tasks
/// diff the working tree against `HEAD`.
fn task_diff_target(db: &Database, task_id: i64) -> Result<(String, bool), String> {
    let task = db
        .task_by_id(task_id)?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.has_worktree {
        let path = task
            .worktree_path
            .ok_or_else(|| "Worktree task is missing its path".to_string())?;
        Ok((path, true))
    } else {
        let repo = db
            .repo_by_id(task.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        Ok((repo.path, false))
    }
}

/// Summarize the files a task changed: its branch vs the base branch for worktree
/// tasks, or the working tree vs `HEAD` for direct-edit tasks.
#[tauri::command]
async fn task_diff_summary(task_id: i64, state: State<'_, AppState>) -> AppResult<TaskDiffSummary> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<TaskDiffSummary, String> {
        let (path, has_worktree) = {
            let db = db.lock();
            task_diff_target(&db, task_id)?
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
    file: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let (path, has_worktree) = {
            let db = db.lock();
            task_diff_target(&db, task_id)?
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

/// Report whether `acli` is installed, authenticated, and the active site.
#[tauri::command]
async fn jira_status() -> AppResult<JiraStatus> {
    tauri::async_runtime::spawn_blocking(jira::status)
        .await
        .map_err(|error| AppError::from(format!("Failed to query JIRA status: {error}")))
}

/// List the JIRA projects visible to the user, for the board's project picker.
#[tauri::command]
async fn jira_list_projects() -> AppResult<Vec<JiraProject>> {
    tauri::async_runtime::spawn_blocking(jira::list_projects)
        .await
        .map_err(|error| AppError::from(format!("Failed to list JIRA projects: {error}")))?
        .map_err(Into::into)
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
        )
    };
    tauri::async_runtime::spawn_blocking(move || jira::search(&jql, 200))
        .await
        .map_err(|error| AppError::from(format!("Failed to load JIRA board: {error}")))?
        .map_err(Into::into)
}

/// Fetch a single work item (e.g. to backfill a story description on attach).
#[tauri::command]
async fn jira_get_work_item(key: String) -> AppResult<JiraWorkItem> {
    tauri::async_runtime::spawn_blocking(move || jira::view(&key))
        .await
        .map_err(|error| AppError::from(format!("Failed to load work item: {error}")))?
        .map_err(Into::into)
}

/// Transition a work item. When a REST token is connected, resolve the target
/// status name to a legal transition id and POST it. The integration is additive:
/// if the REST attempt fails for any reason (revoked/stale token, network error, or
/// no legal transition found), it degrades to the acli path rather than blocking the
/// move — acli uses its own auth and is itself optimistic. JIRA workflow rejections
/// then surface as errors and the UI reverts the card.
#[tauri::command]
async fn jira_transition_work_item(
    state: State<'_, AppState>,
    key: String,
    status: String,
) -> AppResult<()> {
    if let Ok((site, email, token)) = rest_credentials(&state) {
        let (k, s) = (key.clone(), status.clone());
        let rest_result = tauri::async_runtime::spawn_blocking(move || {
            let transitions = jira_rest::list_transitions(&site, &email, &token, &k)?;
            let target = transitions
                .iter()
                .find(|t| t.to_status_name.eq_ignore_ascii_case(&s))
                .ok_or_else(|| {
                    format!("No legal transition to \"{s}\" from the current status")
                })?;
            jira_rest::perform_transition(&site, &email, &token, &k, &target.id)
        })
        .await;
        // Fold a task panic (JoinError) into the same fall-through as an inner
        // Err: any REST failure mode must degrade to acli, never short-circuit
        // to the caller (which `?` on the JoinError would have done).
        let rest_outcome = match rest_result {
            Ok(inner) => inner,
            Err(join_error) => Err(format!("REST transition task failed: {join_error}")),
        };
        match rest_outcome {
            Ok(()) => return Ok(()),
            Err(error) => {
                // Degrade to acli (additive requirement): a revoked token or REST
                // outage must not block a transition acli can still perform.
                tracing::warn!("JIRA REST transition failed, falling back to acli: {error}");
            }
        }
    }
    tauri::async_runtime::spawn_blocking(move || jira::transition(&key, &status))
        .await
        .map_err(|error| AppError::from(format!("Failed to transition work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_assign_work_item(key: String, assignee: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || jira::assign(&key, &assignee))
        .await
        .map_err(|error| AppError::from(format!("Failed to assign work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_comment_work_item(key: String, body: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || jira::comment(&key, &body))
        .await
        .map_err(|error| AppError::from(format!("Failed to comment on work item: {error}")))?
        .map_err(Into::into)
}

/// Create a JIRA work item from the board's structured form, returning the new
/// item (re-fetched so it carries status/type for the board panel). Optional
/// fields are passed through to `acli` only when present.
#[tauri::command]
async fn jira_create_work_item(
    project: String,
    issue_type: String,
    summary: String,
    description: Option<String>,
    assignee: Option<String>,
    labels: Option<String>,
) -> AppResult<JiraWorkItem> {
    tauri::async_runtime::spawn_blocking(move || {
        jira::create(
            &project,
            &issue_type,
            &summary,
            description.as_deref(),
            assignee.as_deref(),
            labels.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to create work item: {error}")))?
    .map_err(Into::into)
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

/// List an issue's legal transitions via REST. Errors if no token is connected.
#[tauri::command]
async fn jira_list_transitions(
    state: State<'_, AppState>,
    key: String,
) -> AppResult<Vec<JiraTransition>> {
    let (site, email, token) = rest_credentials(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        jira_rest::list_transitions(&site, &email, &token, &key)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to list transitions: {error}")))?
    .map_err(Into::into)
}

/// Load a project's full status set via REST (for the board filter + empty columns).
#[tauri::command]
async fn jira_project_statuses(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<JiraStatusDef>> {
    let (site, email, token) = rest_credentials(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        jira_rest::project_statuses(&site, &email, &token, &project)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load project statuses: {error}")))?
    .map_err(Into::into)
}

/// Set or clear the local JIRA story link on a task. Never writes to JIRA.
#[tauri::command]
fn set_task_jira_link(
    task_id: i64,
    key: Option<String>,
    summary: Option<String>,
    url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    app_result(
        state
            .db
            .lock()
            .set_task_jira_link(task_id, key, summary, url),
    )
}

/// Largest consensus round count a caller can request. Each round runs every
/// reviewer once, so this bounds both wall-clock time and token spend.
const MAX_CONSENSUS_ROUNDS: i64 = 5;

/// Start a review of an external pull request: resolve its `owner/repo` to a
/// known project, queue the review, and kick off the background reviewer. One
/// reviewer runs the original single-reviewer flow; two or more runs a
/// multi-model consensus that iterates up to `max_rounds` (default 3) rounds.
#[tauri::command]
fn create_pr_review(
    pr_url: String,
    reviewer_profile_ids: Option<Vec<i64>>,
    max_rounds: Option<i64>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PrReview> {
    enum Kind {
        Single,
        Consensus,
    }

    let (review, kind) = {
        let db = state.db.lock();
        let parsed = github::parse_pull_request_url(&pr_url)?;
        let repo = db
            .resolve_repo_for_owner_repo(&parsed.owner, &parsed.repo)?
            .ok_or_else(|| {
                AppError::from(format!(
                    "Add {}/{} as a project to review its pull requests",
                    parsed.owner, parsed.repo
                ))
            })?;

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
                    .ok_or_else(|| AppError::from("Choose a reviewer profile for the review"))?,
            );
        }

        if reviewer_ids.len() <= 1 {
            let review =
                db.create_pr_review(repo.id, reviewer_ids[0], pr_url.trim(), parsed.number)?;
            (review, Kind::Single)
        } else {
            // The first selected reviewer doubles as the synthesizer.
            let rounds = max_rounds.unwrap_or(3).clamp(1, MAX_CONSENSUS_ROUNDS);
            let review = db.create_consensus_pr_review(
                repo.id,
                reviewer_ids[0],
                &reviewer_ids,
                rounds,
                pr_url.trim(),
                parsed.number,
            )?;
            (review, Kind::Consensus)
        }
    };

    match kind {
        Kind::Single => state
            .sessions
            .run_pr_review(app, state.db.clone(), review.id),
        Kind::Consensus => state
            .sessions
            .run_consensus_pr_review(app, state.db.clone(), review.id),
    }
    Ok(review)
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
fn list_pr_review_runs(
    review_id: i64,
    state: State<'_, AppState>,
) -> AppResult<Vec<PrReviewRun>> {
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
    match review.mode {
        PrReviewMode::Consensus => {
            state
                .sessions
                .run_consensus_pr_review(app, state.db.clone(), review.id)
        }
        PrReviewMode::Single => state
            .sessions
            .run_pr_review(app, state.db.clone(), review.id),
    }
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
                tracing::warn!(?error, review_id, "failed to remove PR review worktree on delete");
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
    state
        .sessions
        .run_pair_review(app, state.db.clone(), task_id)
        .map_err(AppError::from)?;
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

#[tauri::command]
fn start_session(
    task_id: i64,
    agent_profile_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Session> {
    let context = {
        let db = state.db.lock();
        task_session_context(&db, task_id, Some(agent_profile_id))?
    };

    state
        .sessions
        .start(
            app,
            state.db.clone(),
            context.task,
            context.repo,
            context.agent,
            false,
        )
        .map_err(Into::into)
}

#[tauri::command]
fn resume_session(
    task_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Session> {
    let context = {
        let db = state.db.lock();
        let context = task_session_context(&db, task_id, None)?;
        if !matches!(
            context.agent.agent_kind,
            AgentKind::Codex | AgentKind::Claude
        ) {
            return Err("Agent profile does not support resume".into());
        }
        context
    };

    state
        .sessions
        .start(
            app,
            state.db.clone(),
            context.task,
            context.repo,
            context.agent,
            true,
        )
        .map_err(Into::into)
}

#[tauri::command]
fn stop_session(
    session_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Session> {
    let session = state
        .sessions
        .stop(state.db.clone(), session_id.clone())
        .map_err(AppError::from)?;
    let _ = app
        .emit(
            "session_exited",
            SessionExitedEvent {
                session_id,
                exit_code: None,
            },
        )
        .inspect_err(|error| tracing::warn!(?error, "failed to emit session_exited"));
    Ok(session)
}

#[tauri::command]
fn resize_session(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> AppResult<()> {
    app_result(state.sessions.resize(&session_id, rows, cols))
}

#[tauri::command]
fn send_session_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    app_result(state.sessions.write_input(&session_id, &data))
}

#[tauri::command]
fn submit_session_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    app_result(state.sessions.submit_input(&session_id, &data))
}

#[tauri::command]
fn session_output_snapshot(
    session_id: String,
    state: State<'_, AppState>,
) -> AppResult<SessionOutputSnapshot> {
    app_result(state.sessions.output_snapshot(&session_id))
}

pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Failed to find app data directory: {error}"))?;
            tracing::info!(path = %data_dir.display(), "opening app data directory");
            let db = Database::open(data_dir.join("nectus.sqlite3"))?;
            db.clear_active_sessions()?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                sessions: SessionManager::new(),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(state) = window.try_state::<AppState>() {
                    state
                        .sessions
                        .stop_all(window.app_handle(), state.db.clone());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            add_repo,
            list_repos,
            get_app_settings,
            update_app_settings,
            create_task,
            list_tasks,
            update_task_metadata,
            delete_task,
            task_diff_summary,
            task_diff_file,
            github_status,
            create_github_pull_request,
            github_pull_request_status,
            detect_github_pull_request,
            jira_status,
            jira_list_projects,
            jira_search_board,
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
            set_task_jira_link,
            create_pr_review,
            list_pr_reviews,
            get_pr_review,
            list_pr_review_runs,
            rerun_pr_review,
            delete_pr_review,
            list_agent_profiles,
            upsert_agent_profile,
            start_pair_loop,
            run_pair_review,
            stop_pair_loop,
            get_task_review_loop,
            list_task_review_runs,
            start_session,
            resume_session,
            stop_session,
            resize_session,
            send_session_input,
            submit_session_input,
            session_output_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("nectus_desktop_lib=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn task_session_context_loads_task_repo_and_explicit_agent() {
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

        let context = task_session_context(&db, task.id, Some(claude.id)).unwrap();

        assert_eq!(context.task.id, task.id);
        assert_eq!(context.repo.id, repo.id);
        assert_eq!(context.agent.id, claude.id);
    }

    #[test]
    fn task_session_context_uses_stored_agent_for_resume() {
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

        let context = task_session_context(&db, task.id, None).unwrap();

        assert_eq!(context.agent.id, codex.id);
    }

    #[test]
    fn task_session_context_requires_an_agent_for_resume() {
        let db = Database::open_in_memory().unwrap();
        let repo = add_temp_repo(&db);
        let task = db
            .create_task_record(repo.id, "Resume agent".to_string(), None, None, false, None)
            .unwrap();

        let error = task_session_context(&db, task.id, None).unwrap_err();

        assert_eq!(
            error.to_string(),
            "Task does not have an agent profile to resume"
        );
    }
}
