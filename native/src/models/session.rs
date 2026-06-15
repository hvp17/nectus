use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Running,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub resumable_session_id: Option<String>,
    pub resumable_session_label: Option<String>,
    pub task_id: i64,
    pub agent_profile_id: i64,
    pub state: SessionState,
    pub pid: Option<u32>,
    pub started_at: String,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputEvent {
    pub session_id: String,
    pub data: String,
    pub start_offset: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputSnapshot {
    pub session_id: String,
    pub data: String,
    pub truncated: bool,
    pub start_offset: u64,
    pub end_offset: u64,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitedEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SessionIdleEvent {
    pub session_id: String,
    pub task_id: i64,
    pub turn_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SessionNeedsInputEvent {
    pub session_id: String,
    pub task_id: i64,
    pub turn_id: Option<String>,
    pub reason: String,
    pub prompt: Option<String>,
}

/// The agent's latest human-readable activity line, forwarded (throttled,
/// de-duplicated) so task cards can show what a running session is doing without
/// subscribing to the raw terminal stream. Sourced from each provider's
/// structured event stream (Codex reasoning/messages, Claude tool-use hooks,
/// OpenCode message parts); Antigravity and custom agents fall back to a best-effort
/// scrape of the live PTY output.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivityEvent {
    pub session_id: String,
    pub task_id: i64,
    pub line: String,
}
