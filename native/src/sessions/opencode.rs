use super::{emit_session_signal, RunningSession, SessionSignal};
use crate::db::Database;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

const POLL_INTERVAL: Duration = Duration::from_millis(1_000);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenCodeSessionMetadata {
    pub id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenCodeStatus {
    Idle,
    Busy,
    Retry,
}

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

pub(super) fn opencode_status_from_json(json: &str, session_id: &str) -> Option<OpenCodeStatus> {
    let value = serde_json::from_str::<Value>(json).ok()?;
    let status = value
        .get(session_id)
        .or_else(|| {
            value
                .get("sessions")
                .and_then(|sessions| sessions.get(session_id))
        })
        .or_else(|| {
            value
                .get("data")
                .and_then(|data| data.get("sessions"))
                .and_then(|sessions| sessions.get(session_id))
        })?;
    let status_type = status.as_str().or_else(|| text_field(status, "type"))?;
    match status_type {
        "idle" => Some(OpenCodeStatus::Idle),
        "busy" | "working" | "streaming" => Some(OpenCodeStatus::Busy),
        "retry" => Some(OpenCodeStatus::Retry),
        _ => None,
    }
}

pub(super) fn opencode_control_signal_from_json(json: &str) -> Option<SessionSignal> {
    let value = serde_json::from_str::<Value>(json).ok()?;
    if value.is_null() {
        return None;
    }
    let body = value.get("body");
    let payload = body.unwrap_or(&value);
    let reason = text_field(&value, "path")
        .or_else(|| text_field(payload, "type"))
        .or_else(|| text_field(payload, "kind"))
        .or_else(|| text_field(payload, "reason"))
        .or_else(|| text_field(&value, "type"))
        .or_else(|| text_field(&value, "kind"))
        .or_else(|| text_field(&value, "reason"))
        .unwrap_or("control")
        .to_string();
    let prompt =
        prompt_from_control_payload(payload).or_else(|| prompt_from_control_payload(&value));
    if reason == "control" && prompt.is_none() && body.is_none() {
        return None;
    }
    Some(SessionSignal::NeedsInput {
        turn_id: None,
        reason,
        prompt,
    })
}

fn prompt_from_control_payload(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(text.to_string());
    }
    let title = text_field(value, "title");
    let message = text_field(value, "message").or_else(|| text_field(value, "prompt"));
    match (title, message) {
        (Some(title), Some(message)) if title != message => Some(format!("{title}\n{message}")),
        (Some(title), _) => Some(title.to_string()),
        (_, Some(message)) => Some(message.to_string()),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_opencode_event_watcher(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    nectus_session_id: String,
    cwd: PathBuf,
    port: u16,
    emit_initial_idle: bool,
) {
    std::thread::spawn(move || {
        let mut metadata: Option<OpenCodeSessionMetadata> = None;
        let mut last_status: Option<OpenCodeStatus> = None;
        let mut can_emit_initial_idle = emit_initial_idle;
        let mut control_warning_logged = false;
        loop {
            if !sessions.lock().contains_key(&nectus_session_id) {
                return;
            }

            if metadata.is_none() {
                metadata = latest_opencode_session_metadata_from_server(port, &cwd);
                if let Some(metadata) = &metadata {
                    let _ = db
                        .lock()
                        .set_last_session(task_id, &metadata.id, metadata.label.as_deref())
                        .inspect_err(|error| {
                            tracing::warn!(
                                ?error,
                                task_id,
                                "failed to save latest OpenCode session"
                            )
                        });
                    tracing::info!(
                        task_id,
                        opencode_session_id = %metadata.id,
                        "watching OpenCode session status"
                    );
                }
            }

            if let Some(session_id) = metadata.as_ref().map(|metadata| metadata.id.as_str()) {
                if let Ok(body) = get(port, "/session/status") {
                    if let Some(status) = opencode_status_from_json(&body, session_id) {
                        if status == OpenCodeStatus::Idle
                            && (matches!(
                                last_status,
                                Some(OpenCodeStatus::Busy | OpenCodeStatus::Retry)
                            ) || (last_status.is_none() && can_emit_initial_idle))
                        {
                            emit_session_signal(
                                &app,
                                &db,
                                &sessions,
                                task_id,
                                &nectus_session_id,
                                &cwd,
                                SessionSignal::Idle {
                                    turn_id: None,
                                    message: None,
                                },
                            );
                            can_emit_initial_idle = false;
                        }
                        last_status = Some(status);
                    }
                }
            }

            match get(port, "/tui/control/next") {
                Ok(body) => {
                    if let Some(signal) = opencode_control_signal_from_json(&body) {
                        emit_session_signal(
                            &app,
                            &db,
                            &sessions,
                            task_id,
                            &nectus_session_id,
                            &cwd,
                            signal,
                        );
                    }
                }
                Err(error) if !control_warning_logged => {
                    tracing::debug!(
                        ?error,
                        task_id,
                        "OpenCode TUI control endpoint unavailable; needs-input events are best-effort"
                    );
                    control_warning_logged = true;
                }
                Err(_) => {}
            }

            std::thread::sleep(POLL_INTERVAL);
        }
    });
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
    fn parses_status_from_plain_session_status_map() {
        let json = r#"{"ses_1":{"type":"busy"},"ses_2":{"type":"idle"}}"#;

        assert_eq!(
            opencode_status_from_json(json, "ses_2"),
            Some(OpenCodeStatus::Idle)
        );
    }

    #[test]
    fn parses_status_from_wrapped_session_status_map() {
        let json = r#"{"sessions":{"ses_1":{"type":"retry","attempt":2,"message":"rate limit","next":123}}}"#;

        assert_eq!(
            opencode_status_from_json(json, "ses_1"),
            Some(OpenCodeStatus::Retry)
        );
    }

    #[test]
    fn parses_control_request_as_needs_input_signal() {
        let json = r#"{"type":"permission","title":"Run command?","message":"Allow `git push`?"}"#;

        assert!(matches!(
            opencode_control_signal_from_json(json),
            Some(SessionSignal::NeedsInput {
                reason,
                prompt: Some(prompt),
                ..
            }) if reason == "permission" && prompt.contains("git push")
        ));
    }

    #[test]
    fn parses_documented_control_request_wrapper_as_needs_input_signal() {
        let json = r#"{"path":"permission.ask","body":{"title":"Run command?","message":"Allow `git push`?"}}"#;

        assert!(matches!(
            opencode_control_signal_from_json(json),
            Some(SessionSignal::NeedsInput {
                reason,
                prompt: Some(prompt),
                ..
            }) if reason == "permission.ask" && prompt.contains("Run command?") && prompt.contains("git push")
        ));
    }
}
