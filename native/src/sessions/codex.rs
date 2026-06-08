use super::{prompt_preview, watch_event_log, RunningSession, SessionSignal};
use crate::db::Database;
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use walkdir::WalkDir;

const CODEX_METADATA_FAST_POLL_ATTEMPTS: usize = 120;
const CODEX_METADATA_FAST_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CODEX_METADATA_IDLE_POLL_INTERVAL: Duration = Duration::from_secs(5);
/// How often the rollout log is polled for new turn/idle events.
const CODEX_LOG_POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
pub(super) struct CodexSessionMetadata {
    pub id: String,
    pub label: Option<String>,
    path: PathBuf,
}

// ---------------------------------------------------------------------------
// Vendored Codex rollout types
//
// The types below mirror `codex-protocol` @ `rust-v0.136.0` (github.com/openai/
// codex, `codex-rs/protocol/src/{protocol,models}.rs`): names, fields and serde
// attributes match Codex's wire format. They are vendored rather than taken as a
// crate dependency — `codex-protocol` drags in the whole Codex runtime (a
// Starlark interpreter, networking, image decoding) just to parse JSONL, and its
// dependency tree carries a `hashbrown`/`allocative` version conflict that fails
// to build. Keep these in sync with the installed Codex CLI.
// ---------------------------------------------------------------------------

/// One line of a rollout file (`codex_protocol::protocol::RolloutLine`). Codex
/// flattens a `RolloutItem` next to the timestamp; we read the `type`/`payload`
/// pair and decode the payload per item type. (Codex stores `timestamp` as a
/// `String`; we decode the RFC 3339 value straight into a `DateTime`.)
#[derive(Debug, Deserialize)]
struct RolloutLine {
    timestamp: chrono::DateTime<chrono::FixedOffset>,
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    payload: serde_json::Value,
}

/// Subset of `codex_protocol::protocol::EventMsg` (internally tagged on `type`).
/// Only the variants this watcher reacts to are modelled; every other event
/// decodes into `Other`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum EventMsg {
    /// `task_complete` on the v1 wire format; `turn_complete` on v2.
    #[serde(rename = "task_complete", alias = "turn_complete")]
    TurnComplete(TurnCompleteEvent),
    /// `task_started` on v1; `turn_started` on v2.
    #[serde(rename = "task_started", alias = "turn_started")]
    TurnStarted(TurnStartedEvent),
    TurnAborted(TurnAbortedEvent),
    /// Agent's text output and reasoning summary. Both are persisted by default
    /// and carry human-readable prose, so they drive the live activity line.
    AgentMessage(AgentMessageEvent),
    AgentReasoning(AgentReasoningEvent),
    ExecApprovalRequest(InputRequestEvent),
    ApplyPatchApprovalRequest(InputRequestEvent),
    RequestUserInput(InputRequestEvent),
    ElicitationRequest(InputRequestEvent),
    RequestPermissions(InputRequestEvent),
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct TurnCompleteEvent {
    turn_id: String,
    #[serde(default)]
    last_agent_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TurnStartedEvent {
    turn_id: String,
}

/// Codex's `AgentMessageEvent` — the agent's textual reply (`message`).
#[derive(Debug, Deserialize)]
struct AgentMessageEvent {
    #[serde(default)]
    message: Option<String>,
}

/// Codex's `AgentReasoningEvent` — a reasoning summary (`text`), Codex narrating
/// what it is about to do. The richest "doing now" signal in the default rollout.
#[derive(Debug, Deserialize)]
struct AgentReasoningEvent {
    #[serde(default)]
    text: Option<String>,
}

/// Codex's `TurnAbortedEvent`. Upstream `reason` is the snake_case enum
/// `TurnAbortReason`; decoded as a string so unrecognised reasons don't break us.
#[derive(Debug, Deserialize)]
struct TurnAbortedEvent {
    #[serde(default)]
    turn_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Tolerant, shared view of Codex's approval / input-request events
/// (`ExecApprovalRequestEvent`, `ApplyPatchApprovalRequestEvent`,
/// `RequestUserInputEvent`, `ElicitationRequestEvent`,
/// `RequestPermissionsEvent`). Their upstream shapes differ and are field-rich;
/// the watcher only needs the turn id and a human-readable prompt, so we capture
/// the fields that carry one and ignore the rest.
#[derive(Debug, Deserialize)]
struct InputRequestEvent {
    #[serde(default)]
    turn_id: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Subset of `codex_protocol::models::ResponseItem` (internally tagged on
/// `type`). We only act on `request_user_input` tool calls; extra fields on
/// `function_call` (`id`, `namespace`, `call_id`) are ignored.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ResponseItem {
    FunctionCall { name: String, arguments: String },
    #[serde(other)]
    Other,
}

/// `session_meta` payload (`codex_protocol::protocol::SessionMeta`, flattened
/// into `SessionMetaLine` on the wire). `id`/`cwd` are the fields we rely on;
/// `thread_name`/`name`/`title`/`initial_prompt` are label hints read when
/// present (Codex itself exposes no session title), and `model`/`thread_source`/
/// `source` drive sub-agent filtering.
#[derive(Debug, Deserialize)]
struct SessionMeta {
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
    let line = serde_json::from_str::<RolloutLine>(line).ok()?;
    if line.item_type != "session_meta" {
        return None;
    }

    let payload = serde_json::from_value::<SessionMeta>(line.payload).ok()?;
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

fn is_codex_subagent_session(payload: &SessionMeta) -> bool {
    payload.thread_source.as_deref() == Some("subagent")
        || payload.model.as_deref() == Some("codex-auto-review")
        || payload
            .source
            .as_ref()
            .is_some_and(|source| source.get("subagent").is_some())
}

fn codex_session_label(payload: &SessionMeta) -> Option<String> {
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

        watch_event_log(
            &app,
            &db,
            &sessions,
            task_id,
            &session_id,
            &cwd,
            &metadata.path,
            CODEX_LOG_POLL_INTERVAL,
            |line| codex_signal_from_line(line, started_at),
        );
    });
}

/// Translate a Codex rollout line into a [`SessionSignal`], dropping the
/// turn-lifecycle events (started/aborted) that don't map to one.
fn codex_signal_from_line(
    line: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
) -> Option<SessionSignal> {
    match codex_session_event_from_line(line, started_at)? {
        CodexSessionEvent::Idle { turn_id, message } => {
            Some(SessionSignal::Idle { turn_id, message })
        }
        CodexSessionEvent::NeedsInput {
            turn_id,
            reason,
            prompt,
        } => Some(SessionSignal::NeedsInput {
            turn_id,
            reason,
            prompt,
        }),
        CodexSessionEvent::Activity { text } => Some(SessionSignal::Activity { text }),
        CodexSessionEvent::Started { .. } | CodexSessionEvent::Aborted { .. } => None,
    }
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
    Activity {
        text: String,
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
    let line = serde_json::from_str::<RolloutLine>(line).ok()?;
    if line.timestamp < started_at {
        return None;
    }
    // Dispatch on the `RolloutItem` tag, decoding the payload into the vendored
    // Codex type for that line. Unknown event/response variants decode into their
    // `Other` arm and are ignored.
    match line.item_type.as_str() {
        "event_msg" => serde_json::from_value::<EventMsg>(line.payload)
            .ok()
            .and_then(codex_session_event_from_event),
        "response_item" => serde_json::from_value::<ResponseItem>(line.payload)
            .ok()
            .and_then(codex_session_event_from_response_item),
        _ => None,
    }
}

fn codex_session_event_from_event(event: EventMsg) -> Option<CodexSessionEvent> {
    match event {
        EventMsg::TurnComplete(event) => Some(CodexSessionEvent::Idle {
            turn_id: Some(event.turn_id),
            message: event.last_agent_message,
        }),
        EventMsg::TurnStarted(event) => Some(CodexSessionEvent::Started {
            turn_id: Some(event.turn_id),
        }),
        EventMsg::TurnAborted(event) => Some(CodexSessionEvent::Aborted {
            turn_id: event.turn_id,
            reason: event.reason,
        }),
        EventMsg::AgentMessage(event) => codex_activity(event.message.as_deref()),
        EventMsg::AgentReasoning(event) => codex_activity(event.text.as_deref()),
        EventMsg::ExecApprovalRequest(event) => needs_input(event, "exec_approval_request"),
        EventMsg::ApplyPatchApprovalRequest(event) => {
            needs_input(event, "apply_patch_approval_request")
        }
        EventMsg::RequestUserInput(event) => needs_input(event, "request_user_input"),
        EventMsg::ElicitationRequest(event) => needs_input(event, "elicitation_request"),
        EventMsg::RequestPermissions(event) => needs_input(event, "request_permissions"),
        EventMsg::Other => None,
    }
}

/// Build an `Activity` event from an agent message / reasoning summary, bounding
/// the (potentially long) text to a preview. `None` when there is no readable text.
fn codex_activity(text: Option<&str>) -> Option<CodexSessionEvent> {
    prompt_preview(text?).map(|text| CodexSessionEvent::Activity { text })
}

/// Build a `NeedsInput` event from an approval / input-request event, using the
/// first field that carries a human-readable prompt.
fn needs_input(event: InputRequestEvent, reason: &str) -> Option<CodexSessionEvent> {
    Some(CodexSessionEvent::NeedsInput {
        turn_id: event.turn_id,
        reason: reason.to_string(),
        prompt: event
            .prompt
            .or(event.message)
            .or(event.reason)
            .as_deref()
            .and_then(prompt_preview),
    })
}

fn codex_session_event_from_response_item(item: ResponseItem) -> Option<CodexSessionEvent> {
    match item {
        ResponseItem::FunctionCall { name, arguments } if name == "request_user_input" => {
            Some(CodexSessionEvent::NeedsInput {
                turn_id: None,
                reason: "request_user_input".to_string(),
                prompt: request_user_input_prompt(&arguments),
            })
        }
        _ => None,
    }
}

fn request_user_input_prompt(arguments: &str) -> Option<String> {
    let arguments = arguments.trim();
    if arguments.is_empty() {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|value| request_user_input_prompt_from_value(&value))
        .or_else(|| prompt_preview(arguments))
}

fn request_user_input_prompt_from_value(value: &serde_json::Value) -> Option<String> {
    if let Some(question) = value
        .get("question")
        .and_then(|question| question.as_str())
        .and_then(prompt_preview)
    {
        return Some(question);
    }

    let questions = value.get("questions")?.as_array()?;
    let prompts = questions
        .iter()
        .filter_map(|question| question.get("question"))
        .filter_map(|question| question.as_str())
        .filter_map(prompt_preview)
        .collect::<Vec<_>>();
    if prompts.is_empty() {
        None
    } else {
        prompt_preview(&prompts.join(" "))
    }
}

