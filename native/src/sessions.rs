use crate::db::Database;
use crate::models::{
    AgentProfile, Repo, Session, SessionExitedEvent, SessionOutputEvent, SessionState, TaskSummary,
};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
}

struct RunningSession {
    session: Session,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
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

        let executable = resolve_agent_command(&agent.command)?;
        let mut command = CommandBuilder::new(executable);
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
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Failed to open PTY writer: {error}"))?;
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

        self.sessions.lock().insert(
            session.id.clone(),
            RunningSession {
                session: session.clone(),
                master: pair.master,
                writer,
                child,
            },
        );

        std::thread::spawn({
            let app = app.clone();
            let db = db.clone();
            let sessions = self.sessions.clone();
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
                if sessions.lock().remove(&session_id).is_some() {
                    let _ = db.lock().set_active_session(task_id, None);
                    let _ = app.emit(
                        "session_exited",
                        SessionExitedEvent {
                            session_id,
                            exit_code: None,
                        },
                    );
                }
            }
        });

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
        running
            .writer
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

fn resolve_agent_command(command: &str) -> Result<PathBuf, String> {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return if command_path.exists() {
            Ok(command_path.to_path_buf())
        } else {
            Err(format!("Agent command does not exist: {command}"))
        };
    }

    let path_value = env::var_os("PATH").unwrap_or_default();
    for path_dir in env::split_paths(&path_value) {
        let candidate = path_dir.join(command);
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }

    for candidate in bundled_agent_candidates(command) {
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }

    let path_display = path_value.to_string_lossy();
    let fallback_display = bundled_agent_candidates(command)
        .into_iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Unable to find `{command}` in PATH \"{path_display}\"{}",
        if fallback_display.is_empty() {
            String::new()
        } else {
            format!(" or known app locations: {fallback_display}")
        }
    ))
}

fn bundled_agent_candidates(command: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if command == "codex" {
        candidates.push(PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        ));
        if let Some(home) = env::var_os("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Applications")
                    .join("Codex.app")
                    .join("Contents")
                    .join("Resources")
                    .join("codex"),
            );
        }
    }
    candidates
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn resolves_command_from_path() {
        let dir = tempdir().unwrap();
        let executable = dir.path().join("test-agent");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let old_path = env::var_os("PATH");
        env::set_var("PATH", dir.path());
        let resolved = resolve_agent_command("test-agent").unwrap();
        if let Some(old_path) = old_path {
            env::set_var("PATH", old_path);
        } else {
            env::remove_var("PATH");
        }

        assert_eq!(resolved, executable);
    }

    #[test]
    fn preserves_existing_explicit_command_path() {
        let dir = tempdir().unwrap();
        let executable = dir.path().join("agent");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            resolve_agent_command(executable.to_str().unwrap()).unwrap(),
            executable
        );
    }
}
