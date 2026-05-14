use crate::db::Database;
use crate::models::{
    AgentProfile, Repo, Session, SessionExitedEvent, SessionOutputEvent, SessionState, TaskSummary,
};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub struct SessionManager {
    sessions: Mutex<HashMap<String, RunningSession>>,
}

struct RunningSession {
    session: Session,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        task: TaskSummary,
        repo: Repo,
        agent: AgentProfile,
    ) -> Result<Session, String> {
        if task.active_session_id.is_some() {
            return Err("Task already has a running session".into());
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 28,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to open PTY: {error}"))?;

        let mut command = CommandBuilder::new(&agent.command);
        for arg in &agent.args {
            command.arg(arg);
        }
        for (key, value) in &agent.env {
            command.env(key, value);
        }
        let cwd = task.worktree_path.as_deref().unwrap_or(&repo.path);
        command.cwd(cwd);

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Failed to start {}: {error}", agent.name))?;
        let pid = child.process_id();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Failed to create PTY reader: {error}"))?;

        let session = Session {
            id: Uuid::new_v4().to_string(),
            task_id: task.id,
            agent_profile_id: agent.id,
            state: SessionState::Running,
            pid,
            started_at: Utc::now().to_rfc3339(),
            stopped_at: None,
        };
        let session_id = session.id.clone();

        db.lock().set_active_session(task.id, Some(&session_id))?;

        std::thread::spawn({
            let app = app.clone();
            let db = db.clone();
            let task_id = task.id;
            let session_id = session_id.clone();
            move || {
                let mut buffer = [0_u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => {
                            let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                            let _ = app.emit(
                                "session_output",
                                SessionOutputEvent {
                                    session_id: session_id.clone(),
                                    data,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
                let _ = db.lock().set_active_session(task_id, None);
                let _ = app.emit(
                    "session_exited",
                    SessionExitedEvent {
                        session_id,
                        exit_code: None,
                    },
                );
            }
        });

        self.sessions.lock().insert(
            session.id.clone(),
            RunningSession {
                session: session.clone(),
                master: pair.master,
                child,
            },
        );

        Ok(session)
    }

    pub fn stop(&self, db: Arc<Mutex<Database>>, session_id: String) -> Result<Session, String> {
        let mut sessions = self.sessions.lock();
        let mut running = sessions
            .remove(&session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        let _ = running.child.kill();
        let stopped_at = Utc::now().to_rfc3339();
        running.session.state = SessionState::Stopped;
        running.session.stopped_at = Some(stopped_at);
        db.lock()
            .set_active_session(running.session.task_id, None)?;
        Ok(running.session)
    }

    pub fn write_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let running = sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        let mut writer = running
            .master
            .take_writer()
            .map_err(|error| format!("Failed to open PTY writer: {error}"))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("Failed to write to PTY: {error}"))
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let running = sessions
            .get(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        running
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize PTY: {error}"))
    }

    pub fn stop_all(&self, app: &AppHandle, db: Arc<Mutex<Database>>) {
        let ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for session_id in ids {
            if let Ok(session) = self.stop(db.clone(), session_id.clone()) {
                let _ = app.emit(
                    "session_exited",
                    SessionExitedEvent {
                        session_id,
                        exit_code: None,
                    },
                );
                let _ = db.lock().set_active_session(session.task_id, None);
            }
        }
    }
}
