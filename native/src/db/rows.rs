use crate::models::{
    AgentKind, AgentProfile, AppSettings, DensityMode, PrReview, PrReviewMode, PrReviewReviewer,
    PrReviewRun, PrReviewStatus, PrReviewVerdict, Repo, ReviewLoop, ReviewLoopStatus, ReviewRun,
    ReviewVerdict, TaskRepo, TaskStatus, TaskSummary, ThemeMode, Workspace,
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
    PrReviewMode => "pr review mode",
    ThemeMode => "theme mode",
    DensityMode => "density mode",
}

impl FromSql for AgentKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        if text == "gemini" {
            return Ok(AgentKind::Antigravity);
        }
        text.parse()
            .map_err(|_| FromSqlError::Other(format!("Unknown agent kind: {text}").into()))
    }
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
        collapsed: row.get(5)?,
    })
}

pub(super) fn task_from_row(row: &Row<'_>) -> rusqlite::Result<TaskSummary> {
    Ok(TaskSummary {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        workspace_id: row.get(23)?,
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
        attention: row.get(24)?,
        archived: row.get(25)?,
        jira_issue_key: row.get(20)?,
        jira_issue_summary: row.get(21)?,
        jira_issue_url: row.get(22)?,
        // Filled by the caller via a follow-up query against task_repos.
        task_repos: Vec::new(),
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

/// Maps a `task_repos` row joined to `repos` for the name. `is_dirty` is left
/// false here and computed off the DB lock by the command layer (one `git status`
/// per worktree), mirroring how the task's own dirtiness is handled.
pub(super) fn task_repo_from_row(row: &Row<'_>) -> rusqlite::Result<TaskRepo> {
    Ok(TaskRepo {
        repo_id: row.get(0)?,
        repo_name: row.get(1)?,
        branch_name: row.get(2)?,
        worktree_path: row.get(3)?,
        pr_url: row.get(4)?,
        is_dirty: false,
        position: row.get(5)?,
    })
}

/// Maps a `workspaces` row. `repo_ids` is left empty here and populated by the
/// caller with a follow-up query against `workspace_repos` (see `db/workspaces.rs`),
/// mirroring how `pr_review_from_row` leaves `reviewers` for the caller.
pub(super) fn workspace_from_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        repo_ids: Vec::new(),
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        collapsed: row.get(4)?,
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
        jira_rest_email: row.get(12)?,
        jira_filter_statuses: serde_json::from_str::<Vec<String>>(&row.get::<_, String>(13)?)
            .unwrap_or_default(),
        jira_filter_epic: row.get(14)?,
        persistent_sessions: row.get(15)?,
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
/// from `repos`, reviewer name from a LEFT JOIN on `agent_profiles`. `reviewers`
/// is left empty here and populated by the caller with a follow-up query.
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
        mode: row.get(17)?,
        max_rounds: row.get(18)?,
        rounds_completed: row.get(19)?,
        converged: row.get(20)?,
        reviewers: Vec::new(),
    })
}

/// Maps the joined `pr_review_runs` SELECT (see `db/pr_reviews.rs`): reviewer
/// name comes from a LEFT JOIN on `agent_profiles`.
pub(super) fn pr_review_run_from_row(row: &Row<'_>) -> rusqlite::Result<PrReviewRun> {
    Ok(PrReviewRun {
        id: row.get(0)?,
        pr_review_id: row.get(1)?,
        reviewer_profile_id: row.get(2)?,
        reviewer_name: row.get(3)?,
        round: row.get(4)?,
        verdict: row.get(5)?,
        output: row.get(6)?,
        error: row.get(7)?,
        created_at: row.get(8)?,
    })
}

/// Maps a `pr_review_reviewers` row joined to `agent_profiles` for the name.
pub(super) fn pr_review_reviewer_from_row(row: &Row<'_>) -> rusqlite::Result<PrReviewReviewer> {
    Ok(PrReviewReviewer {
        reviewer_profile_id: row.get(0)?,
        reviewer_name: row.get(1)?,
    })
}
