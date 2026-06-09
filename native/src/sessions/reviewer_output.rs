//! Per-provider reviewer stdout decoding.
//!
//! Plain-text reviewer CLIs (Claude, Gemini, custom) emit the review on stdout
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
            AgentKind::Claude | AgentKind::Gemini | AgentKind::Custom => ReviewerWire::Plain,
        }
    }
}

/// Accumulates a reviewer's stdout, yielding human-facing text deltas for live
/// streaming and, at EOF, the full review text plus any captured session id.
pub(super) struct ReviewerOutputCollector {
    wire: ReviewerWire,
    /// Claude supplies its (minted/resumed) id up front; capture providers fill
    /// this in from the stream.
    session_id: Option<String>,
    /// Buffer for an incomplete trailing line (JSON wires only).
    line_buf: String,
    /// Full human-facing review text accumulated so far.
    text: String,
}

impl ReviewerOutputCollector {
    pub(super) fn new(wire: ReviewerWire, session_id: Option<String>) -> Self {
        Self {
            wire,
            session_id,
            line_buf: String::new(),
            text: String::new(),
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
    /// review text (trimmed) plus the resolved session id.
    pub(super) fn finish(mut self) -> (String, Option<String>) {
        if self.wire != ReviewerWire::Plain {
            let line = std::mem::take(&mut self.line_buf);
            let mut sink = String::new();
            self.ingest_line(line.trim(), &mut sink);
        }
        (self.text.trim().to_string(), self.session_id)
    }

    fn ingest_line(&mut self, line: &str, delta: &mut String) {
        if line.is_empty() {
            return;
        }
        let (fragment, session_id) = match self.wire {
            ReviewerWire::CodexJson => parse_codex_event(line),
            ReviewerWire::OpenCodeJson => parse_opencode_event(line),
            ReviewerWire::Plain => (None, None),
        };
        if let Some(session_id) = session_id {
            self.session_id = Some(session_id);
        }
        if let Some(fragment) = fragment {
            self.text.push_str(&fragment);
            delta.push_str(&fragment);
        }
    }
}

/// Parse one Codex `exec --json` event line into `(text_fragment, session_id)`.
/// The id rides the `thread.started` event; the review text rides
/// `item.completed` events whose item is an `agent_message`.
fn parse_codex_event(line: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (None, None);
    };
    match value.get("type").and_then(|t| t.as_str()) {
        Some("thread.started") => (
            None,
            value
                .get("thread_id")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        ),
        Some("item.completed") => {
            let item = value.get("item");
            let is_message =
                item.and_then(|i| i.get("type")).and_then(|t| t.as_str()) == Some("agent_message");
            let text = is_message
                .then(|| item.and_then(|i| i.get("text")).and_then(|t| t.as_str()))
                .flatten()
                .map(str::to_string);
            (text, None)
        }
        _ => (None, None),
    }
}

/// Parse one OpenCode `run --format json` event line into
/// `(text_fragment, session_id)`. Every event carries `sessionID`; the review
/// text rides `type:"text"` events as `part.text`.
fn parse_opencode_event(line: &str) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return (None, None);
    };
    let session_id = value
        .get("sessionID")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let text = (value.get("type").and_then(|t| t.as_str()) == Some("text"))
        .then(|| {
            value
                .get("part")
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
        })
        .flatten()
        .map(str::to_string);
    (text, session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_event_parsing_extracts_thread_id_and_message_text() {
        assert_eq!(
            parse_codex_event(
                r#"{"type":"thread.started","thread_id":"019ea176-226e-70b2-a6b5-cdceddc3c91f"}"#
            ),
            (
                None,
                Some("019ea176-226e-70b2-a6b5-cdceddc3c91f".to_string())
            )
        );
        assert_eq!(
            parse_codex_event(
                r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}"#
            ),
            (Some("ok".to_string()), None)
        );
        assert_eq!(
            parse_codex_event(r#"{"type":"turn.completed","usage":{}}"#),
            (None, None)
        );
        assert_eq!(parse_codex_event("not json"), (None, None));
    }

    #[test]
    fn opencode_event_parsing_extracts_session_id_and_text() {
        let text_line = r#"{"type":"text","timestamp":1,"sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","part":{"id":"prt_x","messageID":"msg_y","sessionID":"ses_15e897088ffeTZK2xT5MsHRUBC","type":"text","text":"ok"}}"#;
        assert_eq!(
            parse_opencode_event(text_line),
            (
                Some("ok".to_string()),
                Some("ses_15e897088ffeTZK2xT5MsHRUBC".to_string())
            )
        );
        assert_eq!(
            parse_opencode_event(
                r#"{"type":"step_start","sessionID":"ses_abc","part":{"id":"p"}}"#
            ),
            (None, Some("ses_abc".to_string()))
        );
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
            ("NECTUS_NO_BLOCKERS".to_string(), Some("tid-1".to_string()))
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
            ("PASS".to_string(), Some("ses_1".to_string()))
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
            ("PASS\nlooks good".to_string(), Some("sid".to_string()))
        );
    }
}
