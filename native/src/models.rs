use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type AppResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub default_worktree_root: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Planned,
    InProgress,
    Review,
    Done,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Planned => "planned",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Review => "review",
            TaskStatus::Done => "done",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "planned" => Ok(TaskStatus::Planned),
            "in_progress" => Ok(TaskStatus::InProgress),
            "review" => Ok(TaskStatus::Review),
            "done" => Ok(TaskStatus::Done),
            _ => Err(format!("Unknown task status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: i64,
    pub repo_id: i64,
    pub title: String,
    pub status: TaskStatus,
    pub pr_url: Option<String>,
    pub agent_profile_id: Option<i64>,
    pub agent_name: Option<String>,
    pub has_worktree: bool,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
    pub is_dirty: bool,
    pub active_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: i64,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileInput {
    pub id: Option<i64>,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitedEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}
