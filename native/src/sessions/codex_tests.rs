use super::codex::{
    codex_metadata_discovery_delay, codex_session_event_from_line,
    codex_session_metadata_from_line, CodexSessionEvent,
};
use std::time::Duration;

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
fn keeps_codex_metadata_discovery_alive_after_initial_window() {
    assert_eq!(
        codex_metadata_discovery_delay(0),
        Duration::from_millis(500)
    );
    assert_eq!(
        codex_metadata_discovery_delay(119),
        Duration::from_millis(500)
    );
    assert_eq!(codex_metadata_discovery_delay(120), Duration::from_secs(5));
    assert_eq!(
        codex_metadata_discovery_delay(10_000),
        Duration::from_secs(5)
    );
}

#[test]
fn recognizes_codex_turn_complete_alias_as_idle_event() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"turn_complete","turn_id":"turn-1","last_agent_message":"Done."}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::Idle {
            turn_id: Some("turn-1".to_string()),
            message: Some("Done.".to_string()),
        })
    );
}

#[test]
fn recognizes_codex_turn_started_events() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"turn_started","turn_id":"turn-1"}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::Started {
            turn_id: Some("turn-1".to_string()),
        })
    );
}

#[test]
fn recognizes_codex_turn_aborted_events() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"turn_aborted","turn_id":"turn-1","reason":"interrupted"}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::Aborted {
            turn_id: Some("turn-1".to_string()),
            reason: Some("interrupted".to_string()),
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
fn ignores_unknown_and_malformed_codex_lines() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let unknown = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"future_event","turn_id":"turn-1"}}"#;

    assert_eq!(codex_session_event_from_line(unknown, started_at), None);
    assert_eq!(codex_session_event_from_line("{not-json", started_at), None);
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

#[test]
fn recognizes_codex_elicitation_events_as_needing_input() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"elicitation_request","turn_id":"turn-3","prompt":"Choose an option"}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::NeedsInput {
            turn_id: Some("turn-3".to_string()),
            reason: "elicitation_request".to_string(),
            prompt: Some("Choose an option".to_string()),
        })
    );
}

#[test]
fn recognizes_codex_request_user_input_function_calls_as_needing_input() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"response_item","payload":{"type":"function_call","name":"request_user_input","arguments":"{\"questions\":[{\"header\":\"V1 Scope\",\"id\":\"v1_scope\",\"question\":\"For the first GitHub integration slice, what should the Create PR step do?\",\"options\":[{\"label\":\"Prompt Agent\",\"description\":\"Send a standard Create PR instruction into Codex.\"}]}]}","call_id":"call_p5QlSzNItLF4xUfr2eh0fAEU"}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::NeedsInput {
            turn_id: None,
            reason: "request_user_input".to_string(),
            prompt: Some(
                "For the first GitHub integration slice, what should the Create PR step do?"
                    .to_string()
            ),
        })
    );
}

#[test]
fn parses_codex_session_metadata_with_top_level_timestamp() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"session_meta","payload":{"id":"codex-session-1","cwd":"/tmp/project","thread_name":" Refactor JSONL parser "}}"#;
    let (timestamp, metadata) = codex_session_metadata_from_line(
        "/tmp/rollout.jsonl".as_ref(),
        line,
        "/tmp/project",
        started_at,
    )
    .unwrap();

    assert_eq!(
        timestamp,
        chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:05.000Z").unwrap()
    );
    assert_eq!(metadata.id, "codex-session-1");
    assert_eq!(metadata.label.as_deref(), Some("Refactor JSONL parser"));
}

#[test]
fn ignores_codex_subagent_session_metadata() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"session_meta","payload":{"id":"codex-guardian-session","timestamp":"2026-05-14T10:00:05.000Z","cwd":"/tmp/project","source":{"subagent":{"other":"guardian"}},"thread_source":"subagent","model":"codex-auto-review"}}"#;

    assert!(codex_session_metadata_from_line(
        "/tmp/guardian.jsonl".as_ref(),
        line,
        "/tmp/project",
        started_at
    )
    .is_none());
}

#[test]
fn recognizes_codex_agent_reasoning_as_activity() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"agent_reasoning","text":"**Investigating the failing test**\n\nLooking at the assertion."}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::Activity {
            text: "**Investigating the failing test**\n\nLooking at the assertion.".to_string(),
        })
    );
}

#[test]
fn recognizes_codex_agent_message_as_activity() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Editing the parser now."}}"#;

    assert_eq!(
        codex_session_event_from_line(line, started_at),
        Some(CodexSessionEvent::Activity {
            text: "Editing the parser now.".to_string(),
        })
    );
}

#[test]
fn codex_agent_message_without_text_is_ignored() {
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
    let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"event_msg","payload":{"type":"agent_message","message":"   "}}"#;

    assert_eq!(codex_session_event_from_line(line, started_at), None);
}
