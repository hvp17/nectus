use super::{review_loop::spawn_review_on_session_idle, RunningSession};
use crate::db::Database;
use crate::models::{SessionIdleEvent, SessionNeedsInputEvent};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone)]
pub(super) struct CodexSessionMetadata {
    pub id: String,
    pub label: Option<String>,
    path: PathBuf,
}

pub(super) fn latest_codex_session_metadata(
    cwd: &Path,
    started_at: &str,
) -> Option<CodexSessionMetadata> {
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

pub(super) fn spawn_codex_event_watcher(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
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
                            spawn_review_on_session_idle(
                                app.clone(),
                                db.clone(),
                                sessions.clone(),
                                task_id,
                                session_id.clone(),
                                cwd.clone(),
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

#[derive(Debug, PartialEq, Eq)]
pub(super) enum CodexSessionEvent {
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

pub(super) fn codex_session_event_from_line(
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
