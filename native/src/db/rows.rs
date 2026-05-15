use crate::models::{
    AgentKind, AgentProfile, AppSettings, DensityMode, Repo, TaskStatus, TaskSummary, ThemeMode,
};
use rusqlite::Row;
use std::collections::BTreeMap;

pub(super) fn rows<T, I>(mapped: I) -> Result<Vec<T>, String>
where
    I: Iterator<Item = rusqlite::Result<T>>,
{
    mapped
        .map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

pub(super) fn repo_from_row(row: &Row<'_>) -> rusqlite::Result<Repo> {
    Ok(Repo {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        default_worktree_root: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub(super) fn task_from_row(row: &Row<'_>) -> rusqlite::Result<Result<TaskSummary, String>> {
    let status: String = row.get(4)?;
    let status = match TaskStatus::from_str(&status) {
        Ok(status) => status,
        Err(error) => return Ok(Err(error)),
    };
    let agent_kind: Option<String> = row.get(8)?;
    let agent_kind = match agent_kind.as_deref().map(AgentKind::from_str).transpose() {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    Ok(Ok(TaskSummary {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        status,
        pr_url: row.get(5)?,
        agent_profile_id: row.get(6)?,
        agent_name: row.get(7)?,
        agent_kind,
        has_worktree: row.get(9)?,
        branch_name: row.get(10)?,
        worktree_path: row.get(11)?,
        is_dirty: false,
        active_session_id: row.get(12)?,
        last_session_id: row.get(13)?,
        last_session_agent: row.get(14)?,
        last_session_cwd: row.get(15)?,
        last_session_label: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    }))
}

pub(super) fn agent_from_row(row: &Row<'_>) -> rusqlite::Result<AgentProfile> {
    let agent_kind: String = row.get(2)?;
    let agent_kind = match AgentKind::from_str(&agent_kind) {
        Ok(kind) => kind,
        Err(error) => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            ));
        }
    };
    let args_json: String = row.get(5)?;
    let env_json: String = row.get(6)?;
    Ok(AgentProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_kind,
        command: row.get(3)?,
        model: row.get(4)?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        env: serde_json::from_str::<BTreeMap<String, String>>(&env_json).unwrap_or_default(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub(super) fn app_settings_from_row(
    row: &Row<'_>,
) -> rusqlite::Result<Result<AppSettings, String>> {
    let theme: String = row.get(3)?;
    let density: String = row.get(4)?;
    let theme = match ThemeMode::from_str(&theme) {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    let density = match DensityMode::from_str(&density) {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };

    Ok(Ok(AppSettings {
        default_agent_profile_id: row.get(0)?,
        default_worktree_root_pattern: row.get(1)?,
        default_branch_prefix: row.get(2)?,
        theme,
        density,
        updated_at: row.get(5)?,
    }))
}
