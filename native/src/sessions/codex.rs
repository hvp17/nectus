use super::{review_loop::spawn_review_on_session_idle, RunningSession};
use crate::db::Database;
use crate::models::{SessionIdleEvent, SessionNeedsInputEvent};
use parking_lot::Mutex;
use serde::{Deserialize, Deserializer};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const CODEX_METADATA_FAST_POLL_ATTEMPTS: usize = 120;
const CODEX_METADATA_FAST_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CODEX_METADATA_IDLE_POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(super) struct CodexSessionMetadata {
    pub id: String,
    pub label: Option<String>,
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct CodexRolloutLine {
    timestamp: chrono::DateTime<chrono::FixedOffset>,
    #[serde(rename = "type")]
    line_type: CodexRolloutLineType,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CodexRolloutLineType {
    SessionMeta,
    ResponseItem,
    Compacted,
    TurnContext,
    EventMsg,
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct CodexSessionMetaPayload {
    id: String,
    cwd: String,
    timestamp: Option<chrono::DateTime<chrono::FixedOffset>>,
    source: Option<serde_json::Value>,
    thread_source: Option<String>,
    model: Option<String>,
    thread_name: Option<String>,
    name: Option<String>,
    title: Option<String>,
    initial_prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexEventPayload {
    #[serde(rename = "type")]
    event_type: CodexEventType,
    turn_id: Option<String>,
    last_agent_message: Option<String>,
    message: Option<String>,
    prompt: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexEventType {
    TaskComplete,
    TurnComplete,
    TaskStarted,
    TurnStarted,
    TurnAborted,
    ExecApprovalRequest,
    RequestPermissions,
    RequestUserInput,
    ElicitationRequest,
    ApplyPatchApprovalRequest,
    Other(String),
}

impl CodexEventType {
    fn as_str(&self) -> &str {
        match self {
            Self::TaskComplete => "task_complete",
            Self::TurnComplete => "turn_complete",
            Self::TaskStarted => "task_started",
            Self::TurnStarted => "turn_started",
            Self::TurnAborted => "turn_aborted",
            Self::ExecApprovalRequest => "exec_approval_request",
            Self::RequestPermissions => "request_permissions",
            Self::RequestUserInput => "request_user_input",
            Self::ElicitationRequest => "elicitation_request",
            Self::ApplyPatchApprovalRequest => "apply_patch_approval_request",
            Self::Other(value) => value,
        }
    }

    fn is_input_request(&self) -> bool {
        match self {
            Self::ExecApprovalRequest
            | Self::RequestPermissions
            | Self::RequestUserInput
            | Self::ElicitationRequest
            | Self::ApplyPatchApprovalRequest => true,
            Self::Other(value) => matches!(
                value.as_str(),
                "approval_request" | "confirmation_request" | "needs_input" | "permission_request"
            ),
            _ => false,
        }
    }
}

impl<'de> Deserialize<'de> for CodexEventType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "task_complete" => Self::TaskComplete,
            "turn_complete" => Self::TurnComplete,
            "task_started" => Self::TaskStarted,
            "turn_started" => Self::TurnStarted,
            "turn_aborted" => Self::TurnAborted,
            "exec_approval_request" => Self::ExecApprovalRequest,
            "request_permissions" => Self::RequestPermissions,
            "request_user_input" => Self::RequestUserInput,
            "elicitation_request" => Self::ElicitationRequest,
            "apply_patch_approval_request" => Self::ApplyPatchApprovalRequest,
            _ => Self::Other(value),
        })
    }
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
    for entry in WalkDir::new(dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.into_path();
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

        let Some((timestamp, metadata)) =
            codex_session_metadata_from_line(&path, &first_line, cwd, started_at)
        else {
            continue;
        };

        if best
            .as_ref()
            .is_none_or(|(best_timestamp, _)| timestamp > *best_timestamp)
        {
            *best = Some((timestamp, metadata));
        }
    }
}

pub(super) fn codex_session_metadata_from_line(
    path: &Path,
    line: &str,
    cwd: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
) -> Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)> {
    let line = serde_json::from_str::<CodexRolloutLine>(line).ok()?;
    if line.line_type != CodexRolloutLineType::SessionMeta {
        return None;
    }

    let payload = serde_json::from_value::<CodexSessionMetaPayload>(line.payload).ok()?;
    if payload.cwd != cwd {
        return None;
    }
    if is_codex_subagent_session(&payload) {
        return None;
    }

    let timestamp = payload.timestamp.unwrap_or(line.timestamp);
    if timestamp < started_at {
        return None;
    }

    Some((
        timestamp,
        CodexSessionMetadata {
            id: payload.id.clone(),
            label: codex_session_label(&payload),
            path: path.to_path_buf(),
        },
    ))
}

fn is_codex_subagent_session(payload: &CodexSessionMetaPayload) -> bool {
    payload.thread_source.as_deref() == Some("subagent")
        || payload.model.as_deref() == Some("codex-auto-review")
        || payload
            .source
            .as_ref()
            .is_some_and(|source| source.get("subagent").is_some())
}

fn codex_session_label(payload: &CodexSessionMetaPayload) -> Option<String> {
    for label in [
        payload.thread_name.as_deref(),
        payload.name.as_deref(),
        payload.title.as_deref(),
        payload.initial_prompt.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let label = label.trim();
        if !label.is_empty() {
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
            Err(error) => {
                tracing::warn!(
                    ?error,
                    session_id = %session_id,
                    "failed to parse session start timestamp"
                );
                return;
            }
        };
        let mut metadata_attempts = 0_usize;
        let metadata = loop {
            if !sessions.lock().contains_key(&session_id) {
                return;
            }
            if let Some(found) = latest_codex_session_metadata(&cwd, &started_at.to_rfc3339()) {
                break found;
            }
            if metadata_attempts == CODEX_METADATA_FAST_POLL_ATTEMPTS {
                tracing::info!(
                    session_id = %session_id,
                    task_id,
                    cwd = %cwd.display(),
                    "continuing Codex metadata discovery while session is active"
                );
            }
            let delay = codex_metadata_discovery_delay(metadata_attempts);
            metadata_attempts = metadata_attempts.saturating_add(1);
            std::thread::sleep(delay);
        };
        tracing::info!(
            session_id = %session_id,
            codex_session_id = %metadata.id,
            path = %metadata.path.display(),
            "watching Codex session log"
        );

        let mut processed_lines = 0_usize;
        loop {
            if !sessions.lock().contains_key(&session_id) {
                return;
            }
            let Ok(contents) = fs::read_to_string(&metadata.path) else {
                tracing::trace!(
                    session_id = %session_id,
                    path = %metadata.path.display(),
                    "Codex session log is not readable yet"
                );
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            for line in contents.lines().skip(processed_lines) {
                if let Some(event) = codex_session_event_from_line(line, started_at) {
                    match event {
                        CodexSessionEvent::Idle { turn_id, message } => {
                            let _ = app
                                .emit(
                                    "session_idle",
                                    SessionIdleEvent {
                                        session_id: session_id.clone(),
                                        task_id,
                                        turn_id,
                                        message,
                                    },
                                )
                                .inspect_err(|error| {
                                    tracing::warn!(
                                        ?error,
                                        session_id = %session_id,
                                        "failed to emit session_idle"
                                    )
                                });
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
                            let _ = app
                                .emit(
                                    "session_needs_input",
                                    SessionNeedsInputEvent {
                                        session_id: session_id.clone(),
                                        task_id,
                                        turn_id,
                                        reason,
                                        prompt,
                                    },
                                )
                                .inspect_err(|error| {
                                    tracing::warn!(
                                        ?error,
                                        session_id = %session_id,
                                        "failed to emit session_needs_input"
                                    )
                                });
                        }
                        CodexSessionEvent::Started { .. } | CodexSessionEvent::Aborted { .. } => {}
                    }
                }
            }
            processed_lines = contents.lines().count();
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

pub(super) fn codex_metadata_discovery_delay(attempt: usize) -> Duration {
    if attempt < CODEX_METADATA_FAST_POLL_ATTEMPTS {
        CODEX_METADATA_FAST_POLL_INTERVAL
    } else {
        CODEX_METADATA_IDLE_POLL_INTERVAL
    }
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
    Started {
        turn_id: Option<String>,
    },
    Aborted {
        turn_id: Option<String>,
        reason: Option<String>,
    },
}

pub(super) fn codex_session_event_from_line(
    line: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
) -> Option<CodexSessionEvent> {
    let line = serde_json::from_str::<CodexRolloutLine>(line).ok()?;
    if line.timestamp < started_at {
        return None;
    }
    if line.line_type != CodexRolloutLineType::EventMsg {
        return None;
    }
    let payload = serde_json::from_value::<CodexEventPayload>(line.payload).ok()?;

    match payload.event_type {
        CodexEventType::TaskComplete | CodexEventType::TurnComplete => {
            Some(CodexSessionEvent::Idle {
                turn_id: payload.turn_id,
                message: payload.last_agent_message,
            })
        }
        CodexEventType::TaskStarted | CodexEventType::TurnStarted => {
            Some(CodexSessionEvent::Started {
                turn_id: payload.turn_id,
            })
        }
        CodexEventType::TurnAborted => Some(CodexSessionEvent::Aborted {
            turn_id: payload.turn_id,
            reason: payload.reason.or(payload.message),
        }),
        event_type if event_type.is_input_request() => Some(CodexSessionEvent::NeedsInput {
            turn_id: payload.turn_id,
            reason: event_type.as_str().to_string(),
            prompt: payload.prompt.or(payload.message).or(payload.reason),
        }),
        _ => None,
    }
}
