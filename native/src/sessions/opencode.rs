//! OpenCode session-metadata probe for post-exit resume (`resolve_resumable_metadata`).
//! ACP chat is the primary surface; the local-server `/event` SSE watcher was removed.

use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenCodeSessionMetadata {
    pub id: String,
    pub label: Option<String>,
}

/// Pick the resumable OpenCode session for `cwd` from a `GET /session` body.
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
    fn skips_subagent_sessions_when_resolving_metadata() {
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
}
