//! Chat transcript persistence (ACP embedded chat).
//!
//! Settled message turns are stored one row each, with their normalized
//! `ChatPart[]` serialized as opaque JSON (`parts_json`) plus the part-model
//! `schema_version`. The chat session row carries the agent's own ACP session id
//! for `session/load` resume. Live, still-streaming messages stay in memory /
//! the frontend store; only settled turns land here, so the transcript replays
//! exactly what the user saw.

use super::{now, Database};
use crate::models::{
    ChatMessage, ChatPart, ChatRole, ChatSession, ChatTranscript, CHAT_PART_SCHEMA_VERSION,
};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

impl Database {
    /// Create a chat session row for a task. `acp_session_id` is filled in later
    /// via [`Database::set_chat_acp_session_id`] once the agent reports it.
    pub fn create_chat_session(
        &self,
        task_id: i64,
        agent_profile_id: Option<i64>,
        cwd: &str,
    ) -> Result<ChatSession, String> {
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        self.conn
            .execute(
                "INSERT INTO chat_sessions
                   (id, task_id, agent_profile_id, acp_session_id, cwd, created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?5)",
                params![id, task_id, agent_profile_id, cwd, timestamp],
            )
            .map_err(|error| format!("Failed to create chat session: {error}"))?;
        Ok(ChatSession {
            id,
            task_id,
            agent_profile_id,
            acp_session_id: None,
            cwd: cwd.to_string(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        })
    }

    /// Record the agent's own ACP session id, so a later resume can `session/load`.
    pub fn set_chat_acp_session_id(&self, id: &str, acp_session_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE chat_sessions SET acp_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![acp_session_id, now(), id],
            )
            .map_err(|error| format!("Failed to update chat session: {error}"))?;
        Ok(())
    }

    /// The most recent chat session for a task (the resume candidate).
    pub fn latest_chat_session(&self, task_id: i64) -> Result<Option<ChatSession>, String> {
        self.conn
            .query_row(
                "SELECT id, task_id, agent_profile_id, acp_session_id, cwd, created_at, updated_at
                 FROM chat_sessions WHERE task_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![task_id],
                chat_session_from_row,
            )
            .optional()
            .map_err(|error| format!("Failed to load chat session: {error}"))
    }

    /// The most recent chat session for a task scoped to one agent profile.
    pub fn latest_chat_session_for_profile(
        &self,
        task_id: i64,
        agent_profile_id: i64,
    ) -> Result<Option<ChatSession>, String> {
        self.conn
            .query_row(
                "SELECT id, task_id, agent_profile_id, acp_session_id, cwd, created_at, updated_at
                 FROM chat_sessions
                 WHERE task_id = ?1 AND agent_profile_id = ?2
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![task_id, agent_profile_id],
                chat_session_from_row,
            )
            .optional()
            .map_err(|error| format!("Failed to load chat session: {error}"))
    }

    /// Append a settled message, or update it in place if a row with the same id
    /// already exists (re-settling a turn). Position is assigned monotonically
    /// within the session.
    pub fn append_chat_message(
        &self,
        chat_session_id: &str,
        task_id: i64,
        message: &ChatMessage,
    ) -> Result<(), String> {
        let parts_json = serde_json::to_string(&message.parts)
            .map_err(|error| format!("Failed to encode chat parts: {error}"))?;
        let position: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM chat_messages WHERE chat_session_id = ?1",
                params![chat_session_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Failed to compute chat message position: {error}"))?;
        self.conn
            .execute(
                "INSERT INTO chat_messages
                   (id, chat_session_id, task_id, role, parts_json, schema_version, position, created_at, completed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   parts_json = excluded.parts_json,
                   completed_at = excluded.completed_at",
                params![
                    message.id,
                    chat_session_id,
                    task_id,
                    message.role.as_str(),
                    parts_json,
                    CHAT_PART_SCHEMA_VERSION,
                    position,
                    message.created_at,
                    message.completed_at,
                ],
            )
            .map_err(|error| format!("Failed to save chat message: {error}"))?;
        Ok(())
    }

    /// All settled messages for a chat session, in order, with parts decoded.
    pub fn list_chat_messages(&self, chat_session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, role, parts_json, created_at, completed_at FROM chat_messages
                 WHERE chat_session_id = ?1 ORDER BY position",
            )
            .map_err(|error| error.to_string())?;
        let raw = stmt
            .query_map(params![chat_session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut messages = Vec::new();
        for row in raw {
            let (id, role, parts_json, created_at, completed_at) =
                row.map_err(|error| error.to_string())?;
            let parts: Vec<ChatPart> = serde_json::from_str(&parts_json)
                .map_err(|error| format!("Failed to decode chat parts for {id}: {error}"))?;
            messages.push(ChatMessage {
                id,
                role: ChatRole::from_db(&role),
                parts,
                created_at,
                completed_at,
            });
        }
        Ok(messages)
    }

    /// The replayable transcript for a task. When `agent_profile_id` is set, the
    /// latest session for that profile is returned; otherwise the latest session
    /// across all profiles (legacy callers).
    pub fn chat_transcript(
        &self,
        task_id: i64,
        agent_profile_id: Option<i64>,
    ) -> Result<ChatTranscript, String> {
        let session = match agent_profile_id {
            Some(profile_id) => self.latest_chat_session_for_profile(task_id, profile_id)?,
            None => self.latest_chat_session(task_id)?,
        };
        let messages = match &session {
            Some(session) => self.list_chat_messages(&session.id)?,
            None => Vec::new(),
        };
        Ok(ChatTranscript { session, messages })
    }
}

fn chat_session_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        agent_profile_id: row.get(2)?,
        acp_session_id: row.get(3)?,
        cwd: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ChatPart, ChatToolStatus};
    use tempfile::TempDir;

    /// A fresh in-memory db with one repo + task, so chat-session FKs resolve.
    fn db_with_task() -> (Database, TempDir, i64) {
        let db = Database::open_in_memory().unwrap();
        let repo_dir = tempfile::tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
        let repo = db
            .add_repo(repo_dir.path().to_string_lossy().to_string())
            .unwrap();
        let task = db
            .create_task_record(repo.id, "Chat task".to_string(), None, None, false, None)
            .unwrap();
        (db, repo_dir, task.id)
    }

    #[test]
    fn chat_transcript_round_trips_messages_in_order() {
        let (db, _dir, task_id) = db_with_task();
        let session = db.create_chat_session(task_id, None, "/work").unwrap();
        assert!(db
            .chat_transcript(task_id, None)
            .unwrap()
            .messages
            .is_empty());

        let user_message = ChatMessage {
            id: "u1".into(),
            role: ChatRole::User,
            parts: vec![ChatPart::Text { text: "hi".into() }],
            created_at: "t0".into(),
            completed_at: Some("t0".into()),
        };
        let agent_message = ChatMessage {
            id: "a1".into(),
            role: ChatRole::Agent,
            parts: vec![
                ChatPart::Reasoning {
                    text: "think".into(),
                },
                ChatPart::Tool {
                    tool_call_id: "c1".into(),
                    title: "Edit".into(),
                    kind: Some("edit".into()),
                    status: ChatToolStatus::Completed,
                    locations: vec![],
                    raw_input: None,
                    output: Some("done".into()),
                },
            ],
            created_at: "t1".into(),
            completed_at: Some("t2".into()),
        };
        db.append_chat_message(&session.id, task_id, &user_message)
            .unwrap();
        db.append_chat_message(&session.id, task_id, &agent_message)
            .unwrap();

        let transcript = db.chat_transcript(task_id, None).unwrap();
        assert_eq!(transcript.session.unwrap().id, session.id);
        assert_eq!(transcript.messages, vec![user_message, agent_message]);
    }

    #[test]
    fn chat_transcript_scopes_to_agent_profile() {
        let (db, _dir, task_id) = db_with_task();
        let claude = db.create_chat_session(task_id, Some(1), "/work").unwrap();
        let opencode = db.create_chat_session(task_id, Some(2), "/work").unwrap();
        let claude_message = ChatMessage {
            id: "claude-1".into(),
            role: ChatRole::Agent,
            parts: vec![ChatPart::Text {
                text: "from claude".into(),
            }],
            created_at: "t0".into(),
            completed_at: Some("t0".into()),
        };
        let opencode_message = ChatMessage {
            id: "opencode-1".into(),
            role: ChatRole::Agent,
            parts: vec![ChatPart::Text {
                text: "from opencode".into(),
            }],
            created_at: "t1".into(),
            completed_at: Some("t1".into()),
        };
        db.append_chat_message(&claude.id, task_id, &claude_message)
            .unwrap();
        db.append_chat_message(&opencode.id, task_id, &opencode_message)
            .unwrap();

        let claude_transcript = db.chat_transcript(task_id, Some(1)).unwrap();
        assert_eq!(claude_transcript.session.unwrap().id, claude.id);
        assert_eq!(claude_transcript.messages, vec![claude_message]);

        let opencode_transcript = db.chat_transcript(task_id, Some(2)).unwrap();
        assert_eq!(opencode_transcript.session.unwrap().id, opencode.id);
        assert_eq!(opencode_transcript.messages, vec![opencode_message]);
    }

    #[test]
    fn append_is_idempotent_on_message_id() {
        let (db, _dir, task_id) = db_with_task();
        let session = db.create_chat_session(task_id, None, "/work").unwrap();
        let mut message = ChatMessage {
            id: "a1".into(),
            role: ChatRole::Agent,
            parts: vec![ChatPart::Text {
                text: "partial".into(),
            }],
            created_at: "t0".into(),
            completed_at: None,
        };
        db.append_chat_message(&session.id, task_id, &message)
            .unwrap();
        message.parts = vec![ChatPart::Text {
            text: "complete".into(),
        }];
        message.completed_at = Some("t1".into());
        db.append_chat_message(&session.id, task_id, &message)
            .unwrap();

        let messages = db.list_chat_messages(&session.id).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0], message);
    }

    #[test]
    fn set_acp_session_id_persists_for_resume() {
        let (db, _dir, task_id) = db_with_task();
        let session = db.create_chat_session(task_id, None, "/work").unwrap();
        db.set_chat_acp_session_id(&session.id, "acp-xyz").unwrap();
        assert_eq!(
            db.latest_chat_session(task_id)
                .unwrap()
                .unwrap()
                .acp_session_id
                .as_deref(),
            Some("acp-xyz")
        );
    }
}
