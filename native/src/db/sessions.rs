use super::{now, Database};
use rusqlite::{params, OptionalExtension};

impl Database {
    pub fn set_active_session(&self, task_id: i64, session_id: Option<&str>) -> Result<(), String> {
        // Clear attention alongside the active session: a session exit/stop ends
        // any "needs you" wait, so the two never drift.
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = ?1, attention = NULL, updated_at = ?2 WHERE id = ?3",
                params![session_id, now(), task_id],
            )
            .map_err(|error| format!("Failed to update active session: {error}"))?;
        Ok(())
    }

    /// Set (or clear) the backend-owned attention signal for a task. `Some("needs_input")`
    /// when the agent is blocked on the user; `None` clears it.
    pub fn set_task_attention(&self, task_id: i64, attention: Option<&str>) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET attention = ?1, updated_at = ?2 WHERE id = ?3",
                params![attention, now(), task_id],
            )
            .map_err(|error| format!("Failed to update task attention: {error}"))?;
        Ok(())
    }

    pub fn start_session_record(
        &self,
        task_id: i64,
        session_id: &str,
        agent: &str,
        cwd: &str,
        label: Option<&str>,
        started_at: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "
                UPDATE tasks
                SET active_session_id = ?1,
                    last_session_id = ?1,
                    last_session_agent = ?2,
                    last_session_cwd = ?3,
                    last_session_label = ?4,
                    last_session_started_at = ?5,
                    attention = NULL,
                    updated_at = ?6
                WHERE id = ?7
                ",
                params![session_id, agent, cwd, label, started_at, now(), task_id],
            )
            .map_err(|error| format!("Failed to update session state: {error}"))?;
        Ok(())
    }

    /// The task currently bound to `session_id`, plus the recorded session start
    /// — what a persistent-session reattach needs to re-register watchers.
    pub fn task_for_active_session(
        &self,
        session_id: &str,
    ) -> Result<Option<(i64, Option<String>)>, String> {
        self.conn
            .query_row(
                "SELECT id, last_session_started_at FROM tasks WHERE active_session_id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn set_last_session(
        &self,
        task_id: i64,
        session_id: &str,
        label: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET last_session_id = ?1, last_session_label = ?2, updated_at = ?3 WHERE id = ?4",
                params![session_id, label, now(), task_id],
            )
            .map_err(|error| format!("Failed to update saved session: {error}"))?;
        Ok(())
    }

    /// Clear stale `active_session_id` markers, keeping the listed ids — the
    /// sessions a persistent-session boot found still alive in tmux and is about
    /// to reattach.
    pub fn clear_active_sessions_except(&self, keep: &[String]) -> Result<(), String> {
        let now_value = now();
        // ?1 is the timestamp; the kept ids follow as ?2..
        let placeholders = (2..=keep.len() + 1)
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = if keep.is_empty() {
            "UPDATE tasks SET active_session_id = NULL, attention = NULL, updated_at = ?1 WHERE active_session_id IS NOT NULL".to_string()
        } else {
            format!(
                "UPDATE tasks SET active_session_id = NULL, attention = NULL, updated_at = ?1 WHERE active_session_id IS NOT NULL AND active_session_id NOT IN ({placeholders})"
            )
        };
        let mut bound: Vec<&dyn rusqlite::ToSql> = vec![&now_value];
        for id in keep {
            bound.push(id);
        }
        self.conn
            .execute(&sql, bound.as_slice())
            .map_err(|error| format!("Failed to clear stale active sessions: {error}"))?;
        Ok(())
    }
}
