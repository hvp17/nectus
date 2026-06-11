//! Per-provider reviewer stdout decoding.
//!
//! Plain-text reviewer CLIs (Claude, Antigravity, custom) emit the review on stdout
//! verbatim. The JSON-event CLIs report the review text AND their session id
//! inside a newline-delimited event stream (Codex `exec --json`, OpenCode
//! `run --format json`); this module extracts both so the launcher can treat
//! every provider uniformly: a human-facing review string plus an optional
//! resolved session id to persist and resume.

use crate::models::AgentKind;

/// How a reviewer's stdout is encoded.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ReviewerWire {
    /// stdout is the review text verbatim.
    Plain,
    /// Newline-delimited Codex `exec --json` events.
    CodexJson,
    /// Newline-delimited OpenCode `run --format json` events.
    OpenCodeJson,
}

impl ReviewerWire {
    pub(super) fn for_kind(kind: AgentKind) -> Self {
        match kind {
            AgentKind::Codex => ReviewerWire::CodexJson,
            AgentKind::OpenCode => ReviewerWire::OpenCodeJson,
            AgentKind::Claude | AgentKind::Antigravity | AgentKind::Custom => ReviewerWire::Plain,
        }
    }
}

/// What one decoded event line carried.
#[derive(Default)]
struct ParsedEvent {
    /// Human-facing review text fragment.
    text: Option<String>,
    /// A captured/updated session id.
    session_id: Option<String>,
    /// A provider-reported error message. Present on failure events that the
    /// JSON-wire CLIs emit on stdout (not stderr) before exiting non-zero.
    error: Option<String>,
}

/// Accumulates a reviewer's stdout, yielding human-facing text deltas for live
/// streaming and, at EOF, the full review text, any captured session id, and any
/// provider-reported error text (so a non-zero exit can be explained).
pub(super) struct ReviewerOutputCollector {
    wire: ReviewerWire,
    /// Claude supplies its (minted/resumed) id up front; capture providers fill
    /// this in from the stream.
    session_id: Option<String>,
    /// Buffer for an incomplete trailing line (JSON wires only).
    line_buf: String,
    /// Full human-facing review text accumulated so far.
    text: String,
    /// Provider-reported error messages accumulated from the stream.
    errors: String,
}

impl ReviewerOutputCollector {
    pub(super) fn new(wire: ReviewerWire, session_id: Option<String>) -> Self {
        Self {
            wire,
            session_id,
            line_buf: String::new(),
            text: String::new(),
            errors: String::new(),
        }
    }

    /// Feed a raw stdout chunk; return the human-facing text delta to stream live
    /// (empty when the chunk carried only protocol/no new text).
    pub(super) fn push(&mut self, chunk: &[u8]) -> String {
        let chunk = String::from_utf8_lossy(chunk);
        if self.wire == ReviewerWire::Plain {
            self.text.push_str(&chunk);
            return chunk.into_owned();
        }
        self.line_buf.push_str(&chunk);
        let mut delta = String::new();
        while let Some(newline) = self.line_buf.find('\n') {
            let line: String = self.line_buf.drain(..=newline).collect();
            self.ingest_line(line.trim(), &mut delta);
        }
        delta
    }

    /// Finalize after EOF: flush any trailing partial line and return the full
    /// review text (trimmed), the resolved session id, and any provider-reported
    /// error text (trimmed) emitted on stdout before a non-zero exit.
    pub(super) fn finish(mut self) -> (String, Option<String>, String) {
        if self.wire != ReviewerWire::Plain {
            let line = std::mem::take(&mut self.line_buf);
            let mut sink = String::new();
            self.ingest_line(line.trim(), &mut sink);
        }
        (
            self.text.trim().to_string(),
            self.session_id,
            self.errors.trim().to_string(),
        )
    }

    fn ingest_line(&mut self, line: &str, delta: &mut String) {
        if line.is_empty() {
            return;
        }
        let event = match self.wire {
            ReviewerWire::CodexJson => parse_codex_event(line),
            ReviewerWire::OpenCodeJson => parse_opencode_event(line),
            ReviewerWire::Plain => ParsedEvent::default(),
        };
        if let Some(session_id) = event.session_id {
            self.session_id = Some(session_id);
        }
        if let Some(fragment) = event.text {
            self.text.push_str(&fragment);
            delta.push_str(&fragment);
        }
        if let Some(error) = event.error {
            if !self.errors.is_empty() {
                self.errors.push('\n');
            }
            self.errors.push_str(&error);
        }
    }
}

/// Parse one Codex `exec --json` event line. The id rides the `thread.started`
/// event; the review text rides `item.completed` events whose item is an
/// `agent_message`; failures ride `error` events as `message` (emitted on stdout
/// before a non-zero exit, with nothing on stderr).
fn parse_codex_event(line: &str) -> ParsedEvent {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return ParsedEvent::default();
    };
    match value.get("type").and_then(|t| t.as_str()) {
        Some("thread.started") => ParsedEvent {
            session_id: value
                .get("thread_id")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            ..Default::default()
        },
        Some("item.completed") => {
            let item = value.get("item");
            let is_message =
                item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) == Some("agent_message");
            ParsedEvent {
                text: is_message
                    .then(|| item.and_then(|i| i.get("text")).and_then(|t| t.as_str()))
                    .flatten()
                    .map(str::to_string),
                ..Default::default()
            }
        }
        Some("error") => ParsedEvent {
            error: value
                .get("message")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            ..Default::default()
        },
        _ => ParsedEvent::default(),
    }
}

/// Parse one OpenCode `run --format json` event line. Every event carries
/// `sessionID`; the review text rides `type:"text"` events as `part.text`;
/// failures ride `type:"error"` events, whose message lives under `error.data`,
/// `error.message`, or a top-level `message` (emitted on stdout before a
/// non-zero exit, with nothing on stderr).
fn parse_opencode_event(line: &str) -> ParsedEvent {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return ParsedEvent::default();
    };
    let kind = value.get("type").and_then(|t| t.as_str());
    let text = (kind == Some("text"))
        .then(|| {
            value
                .get("part")
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
        })
        .flatten()
        .map(str::to_string);
    let error = (kind == Some("error"))
        .then(|| opencode_error_message(&value))
        .flatten();
    ParsedEvent {
        text,
        session_id: value
            .get("sessionID")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        error,
    }
}

/// Pull a human-readable message out of an OpenCode `error` event, tolerating the
/// shapes it has used: `error.data.message`, `error.message`, `error.name`, or a
/// top-level `message`.
fn opencode_error_message(value: &serde_json::Value) -> Option<String> {
    let err = value.get("error");
    err.and_then(|e| e.get("data"))
        .and_then(|d| d.get("message"))
        .and_then(|m| m.as_str())
        .or_else(|| err.and_then(|e| e.get("message")).and_then(|m| m.as_str()))
        .or_else(|| err.and_then(|e| e.get("name")).and_then(|m| m.as_str()))
        .or_else(|| value.get("message").and_then(|m| m.as_str()))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_event_parsing_extracts_thread_id_and_message_text() {
        let started = parse_codex_event(
            r#"{"type":"thread.started","thread_id":"019ea176-226e-70b2-a6b5-cdceddc3c91f"}"#,
        );
        assert_eq!(started.text, None);
        assert_eq!(
            started.session_id,
            Some("019ea176-226e-70b2-a6b5-cdceddc3c91f".to_string())
        );

        let message = parse_codex_event(
            r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}"#,
        );
        assert_eq!(message.text, Some("ok".to_string()));
        assert_eq!(message.session_id, None);

        let other = parse_codex_event(r#"{"type":"turn.completed","usage":{}}"#);
        assert_eq!(other.text, None);
        assert_eq!(other.error, None);

        let not_json = parse_codex_event("not json");
        assert_eq!(not_json.text, None);
        assert_eq!(not_json.session_id, None);
    }

    #[test]
    fn codex_error_event_surfaces_message() {
        let event = parse_codex_event(
            r#"{"type":"error","message":"stream error: unexpected status 401 Unauthorized"}"#,
        );
        assert_eq!(
            event.error,
            Some("stream error: unexpected status 401 Unauthorized".to_string())
        );
        assert_eq!(event.text, None);
    }

    #[test]
    fn opencode_event_parsing_extracts_session_id_and_text() {
        let text_line = r#"{"type":"text","timestamp":1,"sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","part":{"id":"prt_x","messageID":"msg_y","sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","type":"text","text":"ok"}}"#;
        let text_event = parse_opencode_event(text_line);
        assert_eq!(text_event.text, Some("ok".to_string()));
        assert_eq!(
            text_event.session_id,
            Some("ses_15e897088ffeTZK2xT5MsHRUBC".to_string())
        );

        let step = parse_opencode_event(
            r#"{"type":"step_start","sessionID":"ses_abc","part":{"id":"p"}}"#,
        );
        assert_eq!(step.text, None);
        assert_eq!(step.session_id, Some("ses_abc".to_string()));
    }

    #[test]
    fn opencode_error_event_surfaces_message() {
        let nested = parse_opencode_event(
            r#"{"type":"error","sessionID":"ses_1","error":{"name":"ProviderAuthError","data":{"message":"no API key configured"}}}"#,
        );
        assert_eq!(nested.error, Some("no API key configured".to_string()));

        let by_name =
            parse_opencode_event(r#"{"type":"error","error":{"name":"UnknownModelError"}}"#);
        assert_eq!(by_name.error, Some("UnknownModelError".to_string()));
    }

    #[test]
    fn collector_accumulates_codex_stream_across_chunk_boundaries() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::CodexJson, None);
        collector.push(
            b"{\"type\":\"thread.started\",\"thread_id\":\"tid-1\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_m",
        );
        let delta = collector.push(b"essage\",\"text\":\"NECTUS_NO_BLOCKERS\"}}\n");
        assert_eq!(delta, "NECTUS_NO_BLOCKERS");
        assert_eq!(
            collector.finish(),
            (
                "NECTUS_NO_BLOCKERS".to_string(),
                Some("tid-1".to_string()),
                String::new()
            )
        );
    }

    #[test]
    fn collector_captures_codex_error_for_a_failed_run() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::CodexJson, None);
        collector.push(b"{\"type\":\"thread.started\",\"thread_id\":\"tid-1\"}\n");
        collector.push(b"{\"type\":\"error\",\"message\":\"boom\"}\n");
        assert_eq!(
            collector.finish(),
            (String::new(), Some("tid-1".to_string()), "boom".to_string())
        );
    }

    #[test]
    fn collector_accumulates_opencode_text_and_session() {
        let mut collector = ReviewerOutputCollector::new(ReviewerWire::OpenCodeJson, None);
        collector.push(b"{\"type\":\"step_start\",\"sessionID\":\"ses_1\",\"part\":{}}\n");
        let delta = collector
            .push(b"{\"type\":\"text\",\"sessionID\":\"ses_1\",\"part\":{\"type\":\"text\",\"text\":\"PASS\"}}\n");
        assert_eq!(delta, "PASS");
        assert_eq!(
            collector.finish(),
            ("PASS".to_string(), Some("ses_1".to_string()), String::new())
        );
    }

    #[test]
    fn collector_passes_plain_text_through_and_keeps_preset_session() {
        let mut collector =
            ReviewerOutputCollector::new(ReviewerWire::Plain, Some("sid".to_string()));
        assert_eq!(collector.push(b"PASS\n"), "PASS\n");
        assert_eq!(collector.push(b"looks good"), "looks good");
        assert_eq!(
            collector.finish(),
            (
                "PASS\nlooks good".to_string(),
                Some("sid".to_string()),
                String::new()
            )
        );
    }
}
