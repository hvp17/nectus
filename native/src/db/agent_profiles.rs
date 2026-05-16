use super::rows::{agent_from_row, rows};
use super::{now, Database};
use crate::models::{AgentProfile, AgentProfileInput};
use rusqlite::{params, OptionalExtension};

impl Database {
    pub fn list_agent_profiles(&self) -> Result<Vec<AgentProfile>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles ORDER BY id")
            .map_err(|error| error.to_string())?;
        let result = rows(
            stmt.query_map([], agent_from_row)
                .map_err(|error| error.to_string())?,
        );
        result
    }

    pub fn agent_profile_by_id(&self, id: i64) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE id = ?1",
                params![id],
                agent_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn upsert_agent_profile(&self, profile: AgentProfileInput) -> Result<AgentProfile, String> {
        if profile.name.trim().is_empty() {
            return Err("Agent profile name is required".into());
        }
        if profile.command.trim().is_empty() {
            return Err("Agent command is required".into());
        }

        let now = now();
        let model = profile
            .model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_json = serde_json::to_string(&profile.args).map_err(|error| error.to_string())?;
        let env_json = serde_json::to_string(&profile.env).map_err(|error| error.to_string())?;

        if let Some(id) = profile.id {
            self.conn
                .execute(
                    "
                    UPDATE agent_profiles
                    SET name = ?1, agent_kind = ?2, command = ?3, model = ?4, args_json = ?5, env_json = ?6, updated_at = ?7
                    WHERE id = ?8
                    ",
                    params![
                        profile.name,
                        profile.agent_kind.as_str(),
                        profile.command,
                        model,
                        args_json,
                        env_json,
                        now,
                        id
                    ],
                )
                .map_err(|error| format!("Failed to update agent profile: {error}"))?;
            self.agent_profile_by_id(id)?
                .ok_or_else(|| "Agent profile not found after update".into())
        } else {
            self.conn
                .execute(
                    "
                    INSERT INTO agent_profiles (name, agent_kind, command, model, args_json, env_json, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                    ON CONFLICT(name) DO UPDATE SET
                      agent_kind = excluded.agent_kind,
                      command = excluded.command,
                      model = excluded.model,
                      args_json = excluded.args_json,
                      env_json = excluded.env_json,
                      updated_at = excluded.updated_at
                    ",
                    params![
                        profile.name,
                        profile.agent_kind.as_str(),
                        profile.command,
                        model,
                        args_json,
                        env_json,
                        now
                    ],
                )
                .map_err(|error| format!("Failed to save agent profile: {error}"))?;

            self.agent_profile_by_name(&profile.name)?
                .ok_or_else(|| "Agent profile not found after save".into())
        }
    }

    pub(super) fn agent_profile_by_name(&self, name: &str) -> Result<Option<AgentProfile>, String> {
        self.conn
            .query_row(
                "SELECT id, name, agent_kind, command, model, args_json, env_json, created_at, updated_at FROM agent_profiles WHERE name = ?1",
                params![name],
                agent_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
    }
}
