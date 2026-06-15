//! The normalized chat part model — the single contract between the ACP
//! normalization layer (upstream: `sessions::acp` translates each agent's
//! `session/update` notifications into these parts) and the chat renderers
//! (downstream: the React `ChatPane`). Agent-specific wire names never appear
//! here; they live only in the ACP mapping code, so adding or changing an agent
//! never changes this contract.
//!
//! Versioned deliberately: this is the load-bearing schema. Bump
//! [`CHAT_PART_SCHEMA_VERSION`] and note the change when the shape changes.

use serde::{Deserialize, Serialize};

/// The normalized-part schema version. Persisted alongside transcripts so a
/// future shape change can migrate older rows rather than misread them.
pub const CHAT_PART_SCHEMA_VERSION: u32 = 1;

/// Who produced a message turn.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Agent,
}

impl ChatRole {
    /// SQL text representation (the `chat_messages.role` column).
    pub fn as_str(&self) -> &'static str {
        match self {
            ChatRole::User => "user",
            ChatRole::Agent => "agent",
        }
    }

    /// Parse the SQL text representation back. Unknown values fall back to
    /// `Agent` (a stored message is never user-authored unless we wrote "user").
    pub fn from_db(value: &str) -> ChatRole {
        match value {
            "user" => ChatRole::User,
            _ => ChatRole::Agent,
        }
    }
}

/// Lifecycle of a tool call, normalized across agents.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatToolStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

/// A source location a tool touched — the bridge from a tool card to the diff
/// pane. `line` is 1-based when known.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatLocation {
    pub path: String,
    pub line: Option<u32>,
}

/// How a permission option resolves, normalized from ACP's permission kinds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPermissionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

/// One selectable answer to a permission request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatPermissionOption {
    /// The agent-assigned option id, echoed back verbatim when the user picks it.
    pub option_id: String,
    pub label: String,
    pub kind: ChatPermissionKind,
}

/// Status of a single plan entry.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPlanStatus {
    Pending,
    InProgress,
    Completed,
}

/// One entry of an agent's plan/todo list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatPlanEntry {
    pub content: String,
    pub status: ChatPlanStatus,
    pub priority: Option<String>,
}

/// One normalized, renderable part of a turn. Serializes as a discriminated
/// union (`{ "type": "...", ... }`) matching the TS `ChatPart` type. Tag values
/// are snake_case (`text`, `reasoning`, `tool`, `file_edit`, `permission`,
/// `plan`); all fields are camelCase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatPart {
    /// Streamed assistant prose (markdown).
    Text { text: String },
    /// Streamed reasoning / thinking.
    Reasoning { text: String },
    /// A tool call and its evolving status. `locations` feeds the diff bridge;
    /// `output` carries the human-facing result text once available.
    Tool {
        tool_call_id: String,
        title: String,
        kind: Option<String>,
        status: ChatToolStatus,
        locations: Vec<ChatLocation>,
        raw_input: Option<serde_json::Value>,
        output: Option<String>,
    },
    /// A concrete file edit, rendered as a chip; clicking opens the diff.
    FileEdit {
        path: String,
        additions: u32,
        deletions: u32,
        diff: Option<String>,
    },
    /// A pending permission request awaiting the user's decision.
    Permission {
        request_id: String,
        title: String,
        options: Vec<ChatPermissionOption>,
    },
    /// The agent's current plan / todo list.
    Plan { entries: Vec<ChatPlanEntry> },
}

/// One message turn: an ordered list of parts plus lifecycle timestamps.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: ChatRole,
    pub parts: Vec<ChatPart>,
    pub created_at: String,
    /// Set when the turn is settled (no further parts will arrive).
    pub completed_at: Option<String>,
}

/// A persisted chat session for a task. `acp_session_id` is the agent's own
/// session id, kept for `session/load` resume where the agent supports it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub task_id: i64,
    pub agent_profile_id: Option<i64>,
    pub acp_session_id: Option<String>,
    pub cwd: String,
    pub created_at: String,
    pub updated_at: String,
}

/// The replayable transcript for a task: the latest session (resume metadata)
/// plus its settled messages in order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatTranscript {
    pub session: Option<ChatSession>,
    pub messages: Vec<ChatMessage>,
}

/// Pushed to the frontend on every chat update. Carries the full current
/// message snapshot (the frontend upserts by `message.id`); `done` flips it to
/// settled. Snapshot-per-update is the v1 wire format — robust and reducer-free;
/// granular deltas are a later optimization behind this same event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageEvent {
    pub session_id: String,
    pub task_id: i64,
    pub agent_profile_id: Option<i64>,
    pub message: ChatMessage,
    pub done: bool,
}

/// Persisted allow-once/always decision for a permission prompt title.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPermissionPolicyKind {
    AllowAlways,
    RejectAlways,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatPermissionPolicy {
    pub tool_title: String,
    pub kind: ChatPermissionPolicyKind,
    pub created_at: String,
}

/// A git shadow commit captured after an agent turn for checkpoint restore.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatCheckpoint {
    pub id: String,
    pub chat_session_id: String,
    pub task_id: i64,
    pub message_id: String,
    pub git_commit: String,
    pub label: String,
    pub created_at: String,
}

/// Base64 image block attached to a chat prompt (for agents with image capability).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatImageAttachment {
    pub mime_type: String,
    pub data: String,
}

/// Context-window usage pushed when the agent emits a `usage_update` session event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsageEvent {
    pub session_id: String,
    pub task_id: i64,
    pub agent_profile_id: Option<i64>,
    pub used: u64,
    pub size: u64,
}

/// Emitted when an ACP chat connection ends (user stop, crash, or connection error).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionExitedEvent {
    pub session_id: String,
    pub task_id: i64,
    pub agent_profile_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_part_serializes_as_tagged_camelcase() {
        let part = ChatPart::Tool {
            tool_call_id: "call_1".into(),
            title: "Edit file".into(),
            kind: Some("edit".into()),
            status: ChatToolStatus::Running,
            locations: vec![ChatLocation {
                path: "src/main.rs".into(),
                line: Some(12),
            }],
            raw_input: None,
            output: None,
        };
        let value = serde_json::to_value(&part).unwrap();
        assert_eq!(value["type"], "tool");
        assert_eq!(value["toolCallId"], "call_1");
        assert_eq!(value["status"], "running");
        assert_eq!(value["locations"][0]["path"], "src/main.rs");
    }

    #[test]
    fn file_edit_tag_is_snake_case() {
        let part = ChatPart::FileEdit {
            path: "a.ts".into(),
            additions: 3,
            deletions: 1,
            diff: None,
        };
        assert_eq!(serde_json::to_value(&part).unwrap()["type"], "file_edit");
    }

    #[test]
    fn message_round_trips() {
        let message = ChatMessage {
            id: "m1".into(),
            role: ChatRole::Agent,
            parts: vec![ChatPart::Text {
                text: "hello".into(),
            }],
            created_at: "2026-06-15T00:00:00Z".into(),
            completed_at: None,
        };
        let json = serde_json::to_string(&message).unwrap();
        let back: ChatMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(message, back);
    }

    #[test]
    fn role_db_round_trips() {
        assert_eq!(ChatRole::from_db(ChatRole::User.as_str()), ChatRole::User);
        assert_eq!(ChatRole::from_db(ChatRole::Agent.as_str()), ChatRole::Agent);
    }
}
