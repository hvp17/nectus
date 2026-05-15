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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Codex,
    Claude,
    Gemini,
    Custom,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentKind::Codex => "codex",
            AgentKind::Claude => "claude",
            AgentKind::Gemini => "gemini",
            AgentKind::Custom => "custom",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "codex" => Ok(AgentKind::Codex),
            "claude" => Ok(AgentKind::Claude),
            "gemini" => Ok(AgentKind::Gemini),
            "custom" => Ok(AgentKind::Custom),
            _ => Err(format!("Unknown agent kind: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: i64,
    pub name: String,
    pub agent_kind: AgentKind,
    pub command: String,
    pub model: Option<String>,
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
    pub agent_kind: AgentKind,
    pub command: String,
    pub model: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

impl ThemeMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThemeMode::System => "system",
            ThemeMode::Light => "light",
            ThemeMode::Dark => "dark",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "system" => Ok(ThemeMode::System),
            "light" => Ok(ThemeMode::Light),
            "dark" => Ok(ThemeMode::Dark),
            _ => Err(format!("Unknown theme mode: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DensityMode {
    Comfortable,
    Compact,
}

impl DensityMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            DensityMode::Comfortable => "comfortable",
            DensityMode::Compact => "compact",
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "comfortable" => Ok(DensityMode::Comfortable),
            "compact" => Ok(DensityMode::Compact),
            _ => Err(format!("Unknown density mode: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_agent_profile_id: Option<i64>,
    pub default_worktree_root_pattern: String,
    pub default_branch_prefix: Option<String>,
    pub theme: ThemeMode,
    pub density: DensityMode,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsInput {
    pub default_agent_profile_id: Option<i64>,
    pub default_worktree_root_pattern: String,
    pub default_branch_prefix: Option<String>,
    pub theme: ThemeMode,
    pub density: DensityMode,
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
    pub resumable_session_id: Option<String>,
    pub resumable_session_label: Option<String>,
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
    pub start_offset: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputSnapshot {
    pub session_id: String,
    pub data: String,
    pub truncated: bool,
    pub start_offset: u64,
    pub end_offset: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitedEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdleEvent {
    pub session_id: String,
    pub task_id: i64,
    pub turn_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNeedsInputEvent {
    pub session_id: String,
    pub task_id: i64,
    pub turn_id: Option<String>,
    pub reason: String,
    pub prompt: Option<String>,
}
