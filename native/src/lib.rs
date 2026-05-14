mod db;
mod git_ops;
mod models;
mod sessions;

use crate::db::Database;
use crate::models::{
    AgentProfile, AgentProfileInput, AppResult, Repo, Session, TaskStatus, TaskSummary,
};
use crate::sessions::SessionManager;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Manager, State};

pub struct AppState {
    db: Arc<Mutex<Database>>,
    sessions: SessionManager,
}

#[tauri::command]
fn add_repo(path: String, state: State<'_, AppState>) -> AppResult<Repo> {
    state.db.lock().add_repo(path)
}

#[tauri::command]
fn list_repos(state: State<'_, AppState>) -> AppResult<Vec<Repo>> {
    state.db.lock().list_repos()
}

#[tauri::command]
fn create_task(
    repo_id: i64,
    title: String,
    agent_profile_id: Option<i64>,
    has_worktree: Option<bool>,
    branch_name: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    state.db.lock().create_task_record(
        repo_id,
        title,
        agent_profile_id,
        has_worktree.unwrap_or(false),
        branch_name,
    )
}

#[tauri::command]
fn list_tasks(repo_id: Option<i64>, state: State<'_, AppState>) -> AppResult<Vec<TaskSummary>> {
    state.db.lock().list_tasks(repo_id)
}

#[tauri::command]
fn update_task_metadata(
    task_id: i64,
    title: Option<String>,
    status: Option<TaskStatus>,
    pr_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    state
        .db
        .lock()
        .update_task_metadata(task_id, title, status, pr_url)
}

#[tauri::command]
fn list_agent_profiles(state: State<'_, AppState>) -> AppResult<Vec<AgentProfile>> {
    state.db.lock().list_agent_profiles()
}

#[tauri::command]
fn upsert_agent_profile(
    profile: AgentProfileInput,
    state: State<'_, AppState>,
) -> AppResult<AgentProfile> {
    state.db.lock().upsert_agent_profile(profile)
}

#[tauri::command]
fn start_session(
    task_id: i64,
    agent_profile_id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Session> {
    let (task, repo, agent) = {
        let db = state.db.lock();
        let task = db
            .task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        let repo = db
            .repo_by_id(task.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let agent = db
            .agent_profile_by_id(agent_profile_id)?
            .ok_or_else(|| "Agent profile not found".to_string())?;
        (task, repo, agent)
    };

    state
        .sessions
        .start(app, state.db.clone(), task, repo, agent)
}

#[tauri::command]
fn stop_session(session_id: String, state: State<'_, AppState>) -> AppResult<Session> {
    state.sessions.stop(state.db.clone(), session_id)
}

#[tauri::command]
fn resize_session(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.sessions.resize(&session_id, rows, cols)
}

#[tauri::command]
fn send_session_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.sessions.write_input(&session_id, &data)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Failed to find app data directory: {error}"))?;
            let db = Database::open(data_dir.join("nectus.sqlite3"))?;
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
            create_task,
            list_tasks,
            update_task_metadata,
            list_agent_profiles,
            upsert_agent_profile,
            start_session,
            stop_session,
            resize_session,
            send_session_input
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
