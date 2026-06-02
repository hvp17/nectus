mod db;
mod git_ops;
mod github;
mod models;
mod process_util;
mod sessions;

use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, AgentProfileInput, AppError, AppResult, AppSettings, AppSettingsInput,
    GithubStatus, PrReview, PullRequestInfo, Repo, ReviewLoop, ReviewRun, Session,
    SessionExitedEvent, SessionOutputSnapshot, TaskStatus, TaskSummary,
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

#[tauri::command]
fn create_task(
    repo_id: i64,
    title: String,
    prompt: Option<String>,
    agent_profile_id: Option<i64>,
    has_worktree: Option<bool>,
    branch_name: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    app_result(state.db.lock().create_task_record(
        repo_id,
        title,
        prompt,
        agent_profile_id,
        has_worktree.unwrap_or(false),
        branch_name,
    ))
}

#[tauri::command]
fn list_tasks(repo_id: Option<i64>, state: State<'_, AppState>) -> AppResult<Vec<TaskSummary>> {
    app_result(state.db.lock().list_tasks(repo_id))
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
async fn delete_task(task_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.lock().delete_task(task_id))
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

/// Start a review of an external pull request: resolve its `owner/repo` to a
/// known project, queue the review, and kick off the background reviewer.
#[tauri::command]
fn create_pr_review(
    pr_url: String,
    reviewer_profile_id: Option<i64>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PrReview> {
    let review = {
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
        let reviewer_profile_id = match reviewer_profile_id {
            Some(id) => id,
            None => db
                .get_app_settings()?
                .default_agent_profile_id
                .ok_or_else(|| AppError::from("Choose a reviewer profile for the review"))?,
        };
        db.create_pr_review(repo.id, reviewer_profile_id, pr_url.trim(), parsed.number)?
    };

    state.sessions.run_pr_review(app, state.db.clone(), review.id);
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

/// Re-run a finished review: re-fetch the PR head (picking up new commits) and
/// review again.
#[tauri::command]
fn rerun_pr_review(
    review_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PrReview> {
    let review = app_result(state.db.lock().reset_pr_review_for_rerun(review_id))?;
    state.sessions.run_pr_review(app, state.db.clone(), review.id);
    Ok(review)
}

#[tauri::command]
fn delete_pr_review(review_id: i64, state: State<'_, AppState>) -> AppResult<()> {
    let db = state.db.lock();
    if let Some(review) = db.pr_review_by_id(review_id)? {
        if let (Some(worktree), Some(repo)) = (
            review.worktree_path.as_deref(),
            db.repo_by_id(review.repo_id)?,
        ) {
            let _ = git_ops::remove_worktree(Path::new(&repo.path), Path::new(worktree));
        }
    }
    app_result(db.delete_pr_review(review_id))
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
                        .stop_all(&window.app_handle(), state.db.clone());
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
            github_status,
            create_github_pull_request,
            github_pull_request_status,
            detect_github_pull_request,
            create_pr_review,
            list_pr_reviews,
            get_pr_review,
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
