use crate::models::{
    AgentKind, AgentProfile, AppSettings, DensityMode, PrReview, PrReviewStatus, PrReviewVerdict,
    Repo, ReviewLoop, ReviewLoopStatus, ReviewRun, ReviewVerdict, TaskStatus, TaskSummary,
    ThemeMode,
};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::Row;
use std::collections::BTreeMap;
use std::io;

/// Teach rusqlite to read our string-backed enums directly via their
/// strum-derived `FromStr`, so `row.get()` handles the conversion and the row
/// mappers no longer thread an inner `Result<_, String>` for every enum column.
macro_rules! impl_enum_from_sql {
    ($($t:ty => $label:literal),+ $(,)?) => {$(
        impl FromSql for $t {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                let text = value.as_str()?;
                text.parse()
                    .map_err(|_| FromSqlError::Other(format!("Unknown {}: {text}", $label).into()))
            }
        }
    )+};
}

impl_enum_from_sql! {
    TaskStatus => "task status",
    ReviewLoopStatus => "review loop status",
    ReviewVerdict => "review verdict",
    PrReviewStatus => "pr review status",
    PrReviewVerdict => "pr review verdict",
    AgentKind => "agent kind",
    ThemeMode => "theme mode",
    DensityMode => "density mode",
}

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

pub(super) fn task_from_row(row: &Row<'_>) -> rusqlite::Result<TaskSummary> {
    Ok(TaskSummary {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        status: row.get(4)?,
        pr_url: row.get(5)?,
        agent_profile_id: row.get(6)?,
        agent_name: row.get(7)?,
        agent_kind: row.get(8)?,
        has_worktree: row.get(9)?,
        branch_name: row.get(10)?,
        worktree_path: row.get(11)?,
        is_dirty: false,
        active_session_id: row.get(12)?,
        last_session_id: row.get(13)?,
        last_session_agent: row.get(14)?,
        last_session_cwd: row.get(15)?,
        last_session_label: row.get(16)?,
        review_loop_status: row.get(19)?,
        jira_issue_key: row.get(20)?,
        jira_issue_summary: row.get(21)?,
        jira_issue_url: row.get(22)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

pub(super) fn agent_from_row(row: &Row<'_>) -> rusqlite::Result<AgentProfile> {
    let args_json: String = row.get(5)?;
    let env_json: String = row.get(6)?;
    let args = serde_json::from_str(&args_json).map_err(|error| {
        invalid_text_column(
            5,
            format!("Failed to parse agent profile args_json: {error}"),
        )
    })?;
    let env = serde_json::from_str::<BTreeMap<String, String>>(&env_json).map_err(|error| {
        invalid_text_column(
            6,
            format!("Failed to parse agent profile env_json: {error}"),
        )
    })?;
    Ok(AgentProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_kind: row.get(2)?,
        command: row.get(3)?,
        model: row.get(4)?,
        args,
        env,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn invalid_text_column(column: usize, error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        Box::new(io::Error::new(io::ErrorKind::InvalidData, error)),
    )
}

pub(super) fn app_settings_from_row(row: &Row<'_>) -> rusqlite::Result<AppSettings> {
    Ok(AppSettings {
        default_agent_profile_id: row.get(0)?,
        default_worktree_root_pattern: row.get(1)?,
        default_branch_prefix: row.get(2)?,
        theme: row.get(3)?,
        density: row.get(4)?,
        updated_at: row.get(5)?,
        jira_board_jql: row.get(6)?,
        jira_site_url: row.get(7)?,
        jira_board_project: row.get(8)?,
        jira_filter_my_issues: row.get(9)?,
        jira_filter_unresolved: row.get(10)?,
        jira_filter_current_sprint: row.get(11)?,
    })
}

pub(super) fn review_loop_from_row(row: &Row<'_>) -> rusqlite::Result<ReviewLoop> {
    Ok(ReviewLoop {
        task_id: row.get(0)?,
        reviewer_profile_id: row.get(1)?,
        status: row.get(2)?,
        last_error: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub(super) fn review_run_from_row(row: &Row<'_>) -> rusqlite::Result<ReviewRun> {
    Ok(ReviewRun {
        id: row.get(0)?,
        task_id: row.get(1)?,
        reviewer_profile_id: row.get(2)?,
        verdict: row.get(3)?,
        prompt: row.get(4)?,
        output: row.get(5)?,
        error: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// Maps the joined `pr_reviews` SELECT (see `db/pr_reviews.rs`): repo name comes
/// from `repos`, reviewer name from a LEFT JOIN on `agent_profiles`.
pub(super) fn pr_review_from_row(row: &Row<'_>) -> rusqlite::Result<PrReview> {
    Ok(PrReview {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        repo_name: row.get(2)?,
        reviewer_profile_id: row.get(3)?,
        reviewer_name: row.get(4)?,
        pr_url: row.get(5)?,
        pr_number: row.get(6)?,
        pr_title: row.get(7)?,
        pr_author: row.get(8)?,
        base_branch: row.get(9)?,
        status: row.get(10)?,
        review_output: row.get(11)?,
        last_error: row.get(12)?,
        worktree_path: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        verdict: row.get(16)?,
    })
}
