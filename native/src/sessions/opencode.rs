use super::{emit_session_signal, RunningSession, SessionSignal};
use crate::db::Database;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

/// How long to wait between `/session` discovery polls (before the SSE stream is
/// up) and between event-stream reconnect attempts.
const POLL_INTERVAL: Duration = Duration::from_millis(1_000);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenCodeSessionMetadata {
    pub id: String,
    pub label: Option<String>,
}

/// Pick the resumable OpenCode session for `cwd` from a `GET /session` body
/// (an array of `Session` objects). Child/subagent sessions carry a `parentID`
/// and are skipped so resume and event filtering target the top-level task
/// session; ties break on the most recently updated session.
pub(super) fn latest_opencode_session_metadata(
    json: &str,
    cwd: &Path,
) -> Option<OpenCodeSessionMetadata> {
    let value = serde_json::from_str::<Value>(json).ok()?;
    let sessions = value
        .as_array()
        .or_else(|| value.get("sessions").and_then(Value::as_array))
        .or_else(|| value.get("data").and_then(Value::as_array))?;
    let cwd = cwd.to_string_lossy();
    sessions
        .iter()
        .filter(|session| {
            if text_field(session, "parentID").is_some_and(|parent| !parent.is_empty()) {
                return false;
            }
            text_field(session, "directory")
                .or_else(|| text_field(session, "cwd"))
                .is_some_and(|directory| directory == cwd)
        })
        .max_by_key(|session| {
            session
                .get("time")
                .and_then(|time| time.get("updated").or_else(|| time.get("created")))
                .and_then(Value::as_i64)
                .unwrap_or_default()
        })
        .and_then(|session| {
            Some(OpenCodeSessionMetadata {
                id: text_field(session, "id")?.to_string(),
                label: text_field(session, "title").map(str::to_string),
            })
        })
}

/// Translate one decoded `/event` SSE payload into a session signal, ignoring
/// events for any session other than `session_id`. OpenCode exposes a single
/// global event stream per server that also carries subagent sessions, so the
/// session filter keeps Nectus from reacting to nested agent activity.
///
/// `session.idle` maps to turn-complete; the permission/question asks are the
/// canonical "needs input" sources (the TUI renders these as blocking prompts);
/// `message.part.updated` carries the live activity line (the running tool or the
/// streaming assistant text).
pub(super) fn event_signal(json: &str, session_id: &str) -> Option<SessionSignal> {
    let value = serde_json::from_str::<Value>(json).ok()?;
    let event_type = text_field(&value, "type")?;
    let properties = value.get("properties")?;
    if text_field(properties, "sessionID") != Some(session_id) {
        return None;
    }
    match event_type {
        "session.idle" => Some(SessionSignal::Idle {
            turn_id: None,
            message: None,
        }),
        "permission.asked" | "permission.v2.asked" | "question.asked" | "question.v2.asked" => {
            Some(SessionSignal::NeedsInput {
                turn_id: None,
                reason: event_type.to_string(),
                prompt: needs_input_prompt(event_type, properties),
            })
        }
        "message.part.updated" => part_activity(properties.get("part")?),
        _ => None,
    }
}

/// Derive an activity line from a message `part`: the running tool's title (or
/// its tool name) for tool parts, the assistant's text for text parts. Other part
/// kinds (file, step-start/finish, snapshot, patch) carry no readable status.
fn part_activity(part: &Value) -> Option<SessionSignal> {
    let text = match text_field(part, "type")? {
        "tool" => tool_part_label(part),
        "text" => text_field(part, "text").map(str::to_string),
        _ => None,
    }?;
    Some(SessionSignal::Activity { text })
}

/// A tool part's human-readable label: its `state.title` when present (e.g.
/// "Read src/app.ts"), otherwise the bare tool name (e.g. "bash").
fn tool_part_label(part: &Value) -> Option<String> {
    part.get("state")
        .and_then(|state| text_field(state, "title"))
        .or_else(|| text_field(part, "tool"))
        .map(str::to_string)
}

/// Best-effort human-readable summary for a needs-input event. The attention
/// marker fires regardless; this only enriches the toast/inspector text.
fn needs_input_prompt(event_type: &str, properties: &Value) -> Option<String> {
    match event_type {
        "question.asked" | "question.v2.asked" => properties
            .get("questions")
            .and_then(Value::as_array)
            .and_then(|questions| questions.first())
            .and_then(|question| text_field(question, "question"))
            .map(str::to_string),
        "permission.asked" => {
            text_field(properties, "permission").map(|name| format!("Permission requested: {name}"))
        }
        "permission.v2.asked" => {
            let action = text_field(properties, "action")?;
            let resources = properties
                .get("resources")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|resources| !resources.is_empty());
            Some(match resources {
                Some(resources) => format!("Permission requested: {action} ({resources})"),
                None => format!("Permission requested: {action}"),
            })
        }
        _ => None,
    }
}

pub(super) fn spawn_opencode_event_watcher(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    nectus_session_id: String,
    cwd: PathBuf,
    port: u16,
) {
    std::thread::spawn(move || {
        // Discover the top-level OpenCode session id for this task and persist it
        // so the task stays resumable even if it stops before going idle. The
        // local server dies with the OpenCode process, so this must happen while
        // the session is live (the post-exit fetch in mod.rs is best-effort).
        let session_id = loop {
            if !sessions.lock().contains_key(&nectus_session_id) {
                return;
            }
            if let Some(metadata) = latest_opencode_session_metadata_from_server(port, &cwd) {
                let _ = db
                    .lock()
                    .set_last_session(task_id, &metadata.id, metadata.label.as_deref())
                    .inspect_err(|error| {
                        tracing::warn!(?error, task_id, "failed to save latest OpenCode session")
                    });
                tracing::info!(
                    task_id,
                    opencode_session_id = %metadata.id,
                    "watching OpenCode session events"
                );
                break metadata.id;
            }
            std::thread::sleep(POLL_INTERVAL);
        };

        // Consume the local server's `/event` SSE feed for idle and needs-input
        // signals, reconnecting while the Nectus session is alive. The stream
        // closes when the OpenCode process exits, which ends this thread.
        let mut stream_warning_logged = false;
        loop {
            if !sessions.lock().contains_key(&nectus_session_id) {
                return;
            }
            let result = stream_session_events(port, &session_id, |signal| {
                emit_session_signal(
                    &app,
                    &db,
                    &sessions,
                    task_id,
                    &nectus_session_id,
                    &cwd,
                    signal,
                );
            });
            if let Err(error) = result {
                if !stream_warning_logged {
                    tracing::debug!(
                        ?error,
                        task_id,
                        "OpenCode event stream unavailable; retrying"
                    );
                    stream_warning_logged = true;
                }
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}

/// Read the `/event` Server-Sent-Events stream to end-of-stream, forwarding each
/// recognized session signal. Returns `Ok(())` when the stream closes cleanly
/// (the OpenCode server stopped) and `Err` when the connection cannot be made or
/// read, so the caller can decide whether to reconnect.
fn stream_session_events(
    port: u16,
    session_id: &str,
    mut on_signal: impl FnMut(SessionSignal),
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/event");
    let response = event_agent()
        .get(&url)
        .call()
        .map_err(|error| format!("OpenCode event stream error: {error}"))?;
    let reader = BufReader::new(response.into_reader());
    for line in reader.lines() {
        let line = line.map_err(|error| format!("OpenCode event stream read error: {error}"))?;
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        if let Some(signal) = event_signal(data.trim_start(), session_id) {
            on_signal(signal);
        }
    }
    Ok(())
}

pub(super) fn latest_opencode_session_metadata_from_server(
    port: u16,
    cwd: &Path,
) -> Option<OpenCodeSessionMetadata> {
    get(port, "/session")
        .ok()
        .and_then(|body| latest_opencode_session_metadata(&body, cwd))
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Short-lived agent for one-shot `/session` polls. Bounded timeouts keep
/// discovery from blocking the watcher when the server is slow or gone.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(1))
            .timeout_read(Duration::from_secs(1))
            .timeout_write(Duration::from_secs(1))
            .build()
    })
}

/// Agent for the long-lived `/event` stream: a connect timeout guards startup,
/// but there is deliberately no read timeout so the blocking read waits for the
/// next event and unblocks via EOF when the OpenCode server exits.
fn event_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(2))
            .build()
    })
}

fn get(port: u16, path: &str) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    match agent().get(&url).call() {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("Failed to read OpenCode response: {error}")),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!("OpenCode request failed ({code}): {}", body.trim()))
        }
        Err(error) => Err(format!("OpenCode request error: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn finds_latest_session_for_matching_directory() {
        let json = r#"
        [
          {"id":"ses_old","directory":"/repo/app","title":"Old task","time":{"created":1,"updated":10}},
          {"id":"ses_other","directory":"/repo/other","title":"Other","time":{"created":2,"updated":99}},
          {"id":"ses_new","directory":"/repo/app","title":"New task","time":{"created":3,"updated":30}}
        ]
        "#;

        assert_eq!(
            latest_opencode_session_metadata(json, Path::new("/repo/app")),
            Some(OpenCodeSessionMetadata {
                id: "ses_new".to_string(),
                label: Some("New task".to_string()),
            })
        );
    }

    #[test]
    fn skips_subagent_sessions_when_resolving_metadata() {
        // A subagent session for the same directory is more recently updated but
        // carries a parentID, so the top-level task session must still win.
        let json = r#"
        [
          {"id":"ses_main","directory":"/repo/app","title":"Main task","time":{"created":1,"updated":10}},
          {"id":"ses_child","parentID":"ses_main","directory":"/repo/app","title":"Subagent","time":{"created":2,"updated":99}}
        ]
        "#;

        assert_eq!(
            latest_opencode_session_metadata(json, Path::new("/repo/app")),
            Some(OpenCodeSessionMetadata {
                id: "ses_main".to_string(),
                label: Some("Main task".to_string()),
            })
        );
    }

    #[test]
    fn maps_session_idle_event_to_idle_signal() {
        let json = r#"{"id":"evt_1","type":"session.idle","properties":{"sessionID":"ses_app"}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::Idle { .. })
        ));
    }

    #[test]
    fn ignores_events_for_other_sessions() {
        let json =
            r#"{"id":"evt_1","type":"session.idle","properties":{"sessionID":"ses_subagent"}}"#;

        assert!(event_signal(json, "ses_app").is_none());
    }

    #[test]
    fn ignores_non_signal_events() {
        let json = r#"{"id":"evt_1","type":"message.part.delta","properties":{"sessionID":"ses_app","text":"hi"}}"#;

        assert!(event_signal(json, "ses_app").is_none());
    }

    #[test]
    fn maps_permission_ask_to_needs_input_signal() {
        let json = r#"{"id":"evt_2","type":"permission.asked","properties":{"id":"per_1","sessionID":"ses_app","permission":"bash","patterns":[],"metadata":{},"always":[]}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::NeedsInput {
                reason,
                prompt: Some(prompt),
                ..
            }) if reason == "permission.asked" && prompt.contains("bash")
        ));
    }

    #[test]
    fn maps_permission_v2_ask_to_needs_input_signal() {
        let json = r#"{"id":"evt_3","type":"permission.v2.asked","properties":{"id":"per_2","sessionID":"ses_app","action":"git push","resources":["origin"]}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::NeedsInput {
                reason,
                prompt: Some(prompt),
                ..
            }) if reason == "permission.v2.asked" && prompt.contains("git push") && prompt.contains("origin")
        ));
    }

    #[test]
    fn maps_question_ask_to_needs_input_signal_with_prompt() {
        let json = r#"{"id":"evt_4","type":"question.asked","properties":{"id":"que_1","sessionID":"ses_app","questions":[{"question":"Which database should I use?","header":"DB","options":[]}]}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::NeedsInput {
                reason,
                prompt: Some(prompt),
                ..
            }) if reason == "question.asked" && prompt.contains("Which database")
        ));
    }

    #[test]
    fn maps_running_tool_part_to_activity_using_state_title() {
        let json = r#"{"id":"evt_5","type":"message.part.updated","properties":{"sessionID":"ses_app","part":{"id":"prt_1","type":"tool","tool":"read","callID":"c1","state":{"status":"running","title":"Read src/app.ts"}}}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::Activity { text }) if text == "Read src/app.ts"
        ));
    }

    #[test]
    fn maps_tool_part_without_title_to_tool_name() {
        let json = r#"{"id":"evt_6","type":"message.part.updated","properties":{"sessionID":"ses_app","part":{"id":"prt_2","type":"tool","tool":"bash","callID":"c2","state":{"status":"running"}}}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::Activity { text }) if text == "bash"
        ));
    }

    #[test]
    fn maps_text_part_to_activity() {
        let json = r#"{"id":"evt_7","type":"message.part.updated","properties":{"sessionID":"ses_app","part":{"id":"prt_3","type":"text","text":"Editing the parser now"}}}"#;

        assert!(matches!(
            event_signal(json, "ses_app"),
            Some(SessionSignal::Activity { text }) if text == "Editing the parser now"
        ));
    }

    #[test]
    fn ignores_non_status_part_kinds() {
        let json = r#"{"id":"evt_8","type":"message.part.updated","properties":{"sessionID":"ses_app","part":{"id":"prt_4","type":"step-start"}}}"#;

        assert!(event_signal(json, "ses_app").is_none());
    }

    #[test]
    fn ignores_message_part_updated_for_other_sessions() {
        let json = r#"{"id":"evt_9","type":"message.part.updated","properties":{"sessionID":"ses_other","part":{"id":"prt_5","type":"text","text":"hi"}}}"#;

        assert!(event_signal(json, "ses_app").is_none());
    }
}
