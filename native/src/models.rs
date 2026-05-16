use serde::{Deserialize, Serialize, Serializer};
use std::collections::BTreeMap;
use strum::{Display, EnumString, IntoStaticStr};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AppError(String);

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

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

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown task status: {value}"))
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

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ReviewLoopStatus {
    Running,
    Reviewing,
    Passed,
    MaxRoundsReached,
    Error,
    Stopped,
}

impl ReviewLoopStatus {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown review loop status: {value}"))
    }
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ReviewVerdict {
    Pass,
    NeedsChanges,
    Unknown,
}

impl ReviewVerdict {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown review verdict: {value}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLoop {
    pub task_id: i64,
    pub reviewer_profile_id: i64,
    pub max_rounds: i64,
    pub current_round: i64,
    pub status: ReviewLoopStatus,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRun {
    pub id: i64,
    pub task_id: i64,
    pub round: i64,
    pub reviewer_profile_id: i64,
    pub verdict: ReviewVerdict,
    pub prompt: String,
    pub output: String,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunInput {
    pub task_id: i64,
    pub round: i64,
    pub reviewer_profile_id: i64,
    pub verdict: ReviewVerdict,
    pub prompt: String,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLoopUpdatedEvent {
    pub task_id: i64,
    pub review_loop: ReviewLoop,
    pub review_run: Option<ReviewRun>,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentKind {
    Codex,
    Claude,
    Gemini,
    Custom,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown agent kind: {value}"))
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

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

impl ThemeMode {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown theme mode: {value}"))
    }
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DensityMode {
    Comfortable,
    Compact,
}

impl DensityMode {
    pub fn as_str(&self) -> &'static str {
        self.into()
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        value
            .parse()
            .map_err(|_| format!("Unknown density mode: {value}"))
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
