use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, Repo, Session, SessionExitedEvent, SessionOutputEvent,
    SessionOutputSnapshot, SessionState, TaskSummary,
};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

mod codex;
mod command;

#[cfg(test)]
use codex::{codex_session_event_from_line, CodexSessionEvent};
use codex::{latest_codex_session_metadata, spawn_codex_event_watcher};
use command::{configure_agent_command, resolve_agent_command};

const OUTPUT_BUFFER_LIMIT: usize = 2 * 1024 * 1024;

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
}

struct RunningSession {
    session: Session,
    agent_command: String,
    cwd: PathBuf,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output_buffer: String,
    output_truncated: bool,
    output_start_offset: u64,
    output_end_offset: u64,
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
        resume: bool,
    ) -> Result<Session, String> {
        if task.active_session_id.is_some() {
            return Err("Task already has a running session".into());
        }
        let resume_session_id = if resume {
            Some(
                task.last_session_id
                    .as_deref()
                    .ok_or_else(|| "Task does not have a saved session to resume".to_string())?,
            )
        } else {
            None
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 28,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to open PTY: {error}"))?;

        let session_id = resume_session_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let executable = resolve_agent_command(&agent.command)?;
        let mut command = CommandBuilder::new(executable);
        configure_agent_command(&mut command, &agent, &session_id, resume);
        for (key, value) in &agent.env {
            command.env(key, value);
        }
        let cwd = task.worktree_path.as_deref().unwrap_or(&repo.path);
        let cwd_path = PathBuf::from(cwd);
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
            id: session_id.clone(),
            resumable_session_id: Some(session_id.clone()),
            resumable_session_label: task.last_session_label.clone(),
            task_id: task.id,
            agent_profile_id: agent.id,
            state: SessionState::Running,
            pid,
            started_at: Utc::now().to_rfc3339(),
            stopped_at: None,
        };
        let session_id = session.id.clone();
        let started_at = session.started_at.clone();

        db.lock().start_session_record(
            task.id,
            &session_id,
            &agent.command,
            cwd,
            task.last_session_label.as_deref(),
        )?;

        self.sessions.lock().insert(
            session.id.clone(),
            RunningSession {
                session: session.clone(),
                agent_command: agent.agent_kind.as_str().to_string(),
                cwd: cwd_path.clone(),
                master: pair.master,
                writer,
                child,
                output_buffer: String::new(),
                output_truncated: false,
                output_start_offset: 0,
                output_end_offset: 0,
            },
        );

        if agent.agent_kind == AgentKind::Codex {
            spawn_codex_event_watcher(
                app.clone(),
                self.sessions.clone(),
                task.id,
                session_id.clone(),
                cwd_path.clone(),
                started_at.clone(),
            );
        }

        std::thread::spawn({
            let app = app.clone();
            let db = db.clone();
            let sessions = self.sessions.clone();
            let task_id = task.id;
            let session_id = session_id.clone();
            let agent_command = agent.agent_kind.as_str().to_string();
            let cwd = cwd_path;
            let started_at = started_at.clone();
            move || {
                let mut buffer = [0_u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => {
                            let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                            let start_offset = sessions
                                .lock()
                                .get_mut(&session_id)
                                .map(|running| append_output_buffer(running, &data))
                                .unwrap_or(0);
                            let _ = app.emit(
                                "session_output",
                                SessionOutputEvent {
                                    session_id: session_id.clone(),
                                    data,
                                    start_offset,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
                if sessions.lock().remove(&session_id).is_some() {
                    if agent_command == AgentKind::Codex.as_str() {
                        if let Some(metadata) = latest_codex_session_metadata(&cwd, &started_at) {
                            let _ = db.lock().set_last_session(
                                task_id,
                                &metadata.id,
                                metadata.label.as_deref(),
                            );
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
            }
        });

        Ok(session)
    }

    pub fn output_snapshot(&self, session_id: &str) -> Result<SessionOutputSnapshot, String> {
        let sessions = self.sessions.lock();
        let running = sessions
            .get(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        Ok(SessionOutputSnapshot {
            session_id: session_id.to_string(),
            data: running.output_buffer.clone(),
            truncated: running.output_truncated,
            start_offset: running.output_start_offset,
            end_offset: running.output_end_offset,
        })
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
        if running.agent_command == AgentKind::Codex.as_str() {
            if let Some(metadata) =
                latest_codex_session_metadata(&running.cwd, &running.session.started_at)
            {
                db.lock().set_last_session(
                    running.session.task_id,
                    &metadata.id,
                    metadata.label.as_deref(),
                )?;
                running.session.resumable_session_id = Some(metadata.id);
                running.session.resumable_session_label = metadata.label;
            }
        }
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

fn append_output_buffer(running: &mut RunningSession, data: &str) -> u64 {
    let start_offset = running.output_end_offset;
    running.output_buffer.push_str(data);
    running.output_end_offset += data.len() as u64;

    if running.output_buffer.len() > OUTPUT_BUFFER_LIMIT {
        running.output_truncated = true;
        let excess = running.output_buffer.len() - OUTPUT_BUFFER_LIMIT;
        let drain_to = running
            .output_buffer
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= excess)
            .unwrap_or(running.output_buffer.len());
        running.output_buffer.drain(..drain_to);
        running.output_start_offset += drain_to as u64;
    }

    start_offset
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_codex_task_complete_as_idle_event() {
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
        let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Done."}}"#;

        assert_eq!(
            codex_session_event_from_line(line, started_at),
            Some(CodexSessionEvent::Idle {
                turn_id: Some("turn-1".to_string()),
                message: Some("Done.".to_string()),
            })
        );
    }

    #[test]
    fn ignores_codex_events_before_nectus_session_start() {
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
        let line = r#"{"timestamp":"2026-05-14T09:59:59.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"Done."}}"#;

        assert_eq!(codex_session_event_from_line(line, started_at), None);
    }

    #[test]
    fn recognizes_codex_approval_events_as_needing_input() {
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
        let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"exec_approval_request","turn_id":"turn-2","message":"Allow command?"}}"#;

        assert_eq!(
            codex_session_event_from_line(line, started_at),
            Some(CodexSessionEvent::NeedsInput {
                turn_id: Some("turn-2".to_string()),
                reason: "exec_approval_request".to_string(),
                prompt: Some("Allow command?".to_string()),
            })
        );
    }
}
