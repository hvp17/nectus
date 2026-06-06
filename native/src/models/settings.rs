use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_agent_profile_id: Option<i64>,
    pub default_worktree_root_pattern: String,
    pub default_branch_prefix: Option<String>,
    pub jira_board_jql: Option<String>,
    pub jira_site_url: Option<String>,
    pub jira_board_project: Option<String>,
    pub jira_filter_my_issues: bool,
    pub jira_filter_unresolved: bool,
    pub jira_filter_current_sprint: bool,
    /// Non-secret REST account email (Basic-auth username). Written only by the
    /// API-token flow, never by the general settings save. The token itself lives
    /// in the Keychain.
    pub jira_rest_email: Option<String>,
    /// Board status filter selection (the statuses to show); empty means no filter.
    pub jira_filter_statuses: Vec<String>,
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
    #[serde(default)]
    pub jira_board_jql: Option<String>,
    #[serde(default)]
    pub jira_site_url: Option<String>,
    #[serde(default)]
    pub jira_board_project: Option<String>,
    #[serde(default)]
    pub jira_filter_my_issues: bool,
    #[serde(default)]
    pub jira_filter_unresolved: bool,
    #[serde(default)]
    pub jira_filter_current_sprint: bool,
    #[serde(default)]
    pub jira_filter_statuses: Vec<String>,
    pub theme: ThemeMode,
    pub density: DensityMode,
}
