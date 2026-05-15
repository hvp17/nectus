use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, Repo, Session, SessionExitedEvent, SessionIdleEvent,
    SessionNeedsInputEvent, SessionOutputEvent, SessionOutputSnapshot, SessionState, TaskSummary,
};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

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

    for candidate in fallback_agent_candidates(command) {
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }

    let path_display = path_value.to_string_lossy();
    let fallback_display = fallback_agent_candidates(command)
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

fn fallback_agent_candidates(command: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.extend(user_bin_candidates(command));
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

fn user_bin_candidates(command: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local").join("bin").join(command));
        candidates.push(home.join(".cargo").join("bin").join(command));
        candidates.push(home.join(".npm-global").join("bin").join(command));
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/local/sbin",
        "/opt/homebrew/sbin",
    ] {
        candidates.push(PathBuf::from(dir).join(command));
    }
    candidates
}

fn configure_agent_command(
    command: &mut CommandBuilder,
    agent: &AgentProfile,
    session_id: &str,
    resume: bool,
) {
    if should_pass_model(agent.agent_kind, resume) {
        if let Some(model) = agent
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.arg("--model");
            command.arg(model);
        }
    }

    if resume && agent.agent_kind == AgentKind::Codex {
        command.arg("resume");
    }
    for arg in &agent.args {
        command.arg(arg);
    }
    if resume && agent.agent_kind == AgentKind::Codex {
        command.arg(session_id);
    }
    if agent.agent_kind == AgentKind::Claude {
        if resume {
            command.arg("--resume");
            command.arg(session_id);
        } else {
            command.arg("--session-id");
            command.arg(session_id);
        }
    }
}

fn should_pass_model(agent_kind: AgentKind, resume: bool) -> bool {
    matches!(
        agent_kind,
        AgentKind::Codex | AgentKind::Claude | AgentKind::Gemini
    ) && !(resume && agent_kind == AgentKind::Codex)
}

#[derive(Debug, Clone)]
struct CodexSessionMetadata {
    id: String,
    label: Option<String>,
    path: PathBuf,
}

fn latest_codex_session_metadata(cwd: &Path, started_at: &str) -> Option<CodexSessionMetadata> {
    let home = env::var_os("HOME")?;
    let sessions_dir = PathBuf::from(home).join(".codex").join("sessions");
    let started_at = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let cwd = cwd.to_string_lossy();
    let mut best: Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)> = None;
    collect_codex_session_ids(&sessions_dir, &cwd, started_at, &mut best);
    best.map(|(_, metadata)| metadata)
}

fn collect_codex_session_ids(
    dir: &Path,
    cwd: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
    best: &mut Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_codex_session_ids(&path, cwd, started_at, best);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let mut reader = BufReader::new(file);
        let mut first_line = String::new();
        let Ok(bytes_read) = reader.read_line(&mut first_line) else {
            continue;
        };
        if bytes_read == 0 {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&first_line) else {
            continue;
        };
        if value.pointer("/type").and_then(|value| value.as_str()) != Some("session_meta") {
            continue;
        }
        let Some(payload) = value.pointer("/payload") else {
            continue;
        };
        if payload.pointer("/cwd").and_then(|value| value.as_str()) != Some(cwd) {
            continue;
        }
        let Some(id) = payload
            .pointer("/id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        let Some(timestamp) = payload
            .pointer("/timestamp")
            .and_then(|value| value.as_str())
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        else {
            continue;
        };
        if timestamp < started_at {
            continue;
        }
        if best
            .as_ref()
            .is_none_or(|(best_timestamp, _)| timestamp > *best_timestamp)
        {
            *best = Some((
                timestamp,
                CodexSessionMetadata {
                    id,
                    label: codex_session_label(payload),
                    path: path.clone(),
                },
            ));
        }
    }
}

fn codex_session_label(payload: &serde_json::Value) -> Option<String> {
    for pointer in ["/thread_name", "/name", "/title", "/initial_prompt"] {
        if let Some(label) = payload
            .pointer(pointer)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(label.chars().take(120).collect());
        }
    }
    None
}

#[derive(Debug, PartialEq, Eq)]
enum CodexSessionEvent {
    Idle {
        turn_id: Option<String>,
        message: Option<String>,
    },
    NeedsInput {
        turn_id: Option<String>,
        reason: String,
        prompt: Option<String>,
    },
}

fn spawn_codex_event_watcher(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: String,
    cwd: PathBuf,
    started_at: String,
) {
    std::thread::spawn(move || {
        let started_at = match chrono::DateTime::parse_from_rfc3339(&started_at) {
            Ok(value) => value,
            Err(_) => return,
        };
        let mut metadata = None;
        for _ in 0..120 {
            if !sessions.lock().contains_key(&session_id) {
                return;
            }
            if let Some(found) = latest_codex_session_metadata(&cwd, &started_at.to_rfc3339()) {
                metadata = Some(found);
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let Some(metadata) = metadata else {
            return;
        };

        let mut processed_lines = 0_usize;
        loop {
            if !sessions.lock().contains_key(&session_id) {
                return;
            }
            let Ok(contents) = fs::read_to_string(&metadata.path) else {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            for line in contents.lines().skip(processed_lines) {
                if let Some(event) = codex_session_event_from_line(line, started_at) {
                    match event {
                        CodexSessionEvent::Idle { turn_id, message } => {
                            let _ = app.emit(
                                "session_idle",
                                SessionIdleEvent {
                                    session_id: session_id.clone(),
                                    task_id,
                                    turn_id,
                                    message,
                                },
                            );
                        }
                        CodexSessionEvent::NeedsInput {
                            turn_id,
                            reason,
                            prompt,
                        } => {
                            let _ = app.emit(
                                "session_needs_input",
                                SessionNeedsInputEvent {
                                    session_id: session_id.clone(),
                                    task_id,
                                    turn_id,
                                    reason,
                                    prompt,
                                },
                            );
                        }
                    }
                }
            }
            processed_lines = contents.lines().count();
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

fn codex_session_event_from_line(
    line: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
) -> Option<CodexSessionEvent> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let timestamp = value
        .pointer("/timestamp")
        .and_then(|value| value.as_str())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())?;
    if timestamp < started_at {
        return None;
    }
    if value.pointer("/type").and_then(|value| value.as_str()) != Some("event_msg") {
        return None;
    }
    let payload = value.pointer("/payload")?;
    let payload_type = payload.pointer("/type").and_then(|value| value.as_str())?;
    match payload_type {
        "task_complete" => Some(CodexSessionEvent::Idle {
            turn_id: payload
                .pointer("/turn_id")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
            message: payload
                .pointer("/last_agent_message")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
        }),
        value if is_codex_needs_input_event(value) => Some(CodexSessionEvent::NeedsInput {
            turn_id: payload
                .pointer("/turn_id")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
            reason: payload_type.to_string(),
            prompt: payload
                .pointer("/prompt")
                .or_else(|| payload.pointer("/message"))
                .or_else(|| payload.pointer("/reason"))
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
        }),
        _ => None,
    }
}

fn is_codex_needs_input_event(payload_type: &str) -> bool {
    let normalized = payload_type.to_ascii_lowercase();
    normalized.contains("approval")
        || normalized.contains("permission")
        || normalized.contains("confirmation")
        || normalized.contains("request_user_input")
        || normalized.contains("needs_input")
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

    #[test]
    fn resolves_command_from_user_local_bin_when_gui_path_is_minimal() {
        let home = tempdir().unwrap();
        let bin_dir = home.path().join(".local").join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let executable = bin_dir.join("claude");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let old_home = env::var_os("HOME");
        let old_path = env::var_os("PATH");
        env::set_var("HOME", home.path());
        env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        let resolved = resolve_agent_command("claude").unwrap();
        if let Some(old_home) = old_home {
            env::set_var("HOME", old_home);
        } else {
            env::remove_var("HOME");
        }
        if let Some(old_path) = old_path {
            env::set_var("PATH", old_path);
        } else {
            env::remove_var("PATH");
        }

        assert_eq!(resolved, executable);
    }

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
