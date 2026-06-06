use super::{AgentKind, ReviewLoopStatus};
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub default_worktree_root: String,
    pub created_at: String,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TaskStatus {
    Planned,
    InProgress,
    Review,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: i64,
    pub repo_id: i64,
    pub title: String,
    pub prompt: Option<String>,
    pub status: TaskStatus,
    pub pr_url: Option<String>,
    pub agent_profile_id: Option<i64>,
    pub agent_name: Option<String>,
    pub agent_kind: Option<AgentKind>,
    pub has_worktree: bool,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub is_dirty: bool,
    pub active_session_id: Option<String>,
    pub last_session_id: Option<String>,
    pub last_session_agent: Option<String>,
    pub last_session_cwd: Option<String>,
    pub last_session_label: Option<String>,
    pub review_loop_status: Option<ReviewLoopStatus>,
    pub jira_issue_key: Option<String>,
    pub jira_issue_summary: Option<String>,
    pub jira_issue_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// How a single file changed in a task diff. `Untracked` is a new file git is not
/// yet tracking (distinct from a staged `Added`). Rename detection is disabled, so
/// a rename surfaces as a `Deleted` + `Added` pair rather than a dedicated kind.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiffChangeKind {
    Added,
    Modified,
    Deleted,
    Untracked,
}

/// One changed file in a task diff. `additions`/`deletions` are line counts;
/// `binary` files carry no line counts and no patch body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileEntry {
    pub path: String,
    pub change: DiffChangeKind,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

/// The changed-file list for a task. `base_label` names what the diff is compared
/// against (e.g. `origin/main`); `None` for a direct-edit working-tree diff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDiffSummary {
    pub base_label: Option<String>,
    pub files: Vec<DiffFileEntry>,
}
