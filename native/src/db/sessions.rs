use super::{now, Database};
use rusqlite::params;

impl Database {
    pub fn set_active_session(&self, task_id: i64, session_id: Option<&str>) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![session_id, now(), task_id],
            )
            .map_err(|error| format!("Failed to update active session: {error}"))?;
        Ok(())
    }

    pub fn start_session_record(
        &self,
        task_id: i64,
        session_id: &str,
        agent: &str,
        cwd: &str,
        label: Option<&str>,
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
                    updated_at = ?5
                WHERE id = ?6
                ",
                params![session_id, agent, cwd, label, now(), task_id],
            )
            .map_err(|error| format!("Failed to update session state: {error}"))?;
        Ok(())
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

    pub fn clear_active_sessions(&self) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE tasks SET active_session_id = NULL, updated_at = ?1 WHERE active_session_id IS NOT NULL",
                params![now()],
            )
            .map_err(|error| format!("Failed to clear stale active sessions: {error}"))?;
        Ok(())
    }
}
