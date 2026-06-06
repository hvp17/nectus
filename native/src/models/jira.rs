use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub account: Option<String>,
    pub site: Option<String>,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum JiraStatusCategory {
    ToDo,
    InProgress,
    Done,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraProject {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraWorkItem {
    pub key: String,
    pub summary: String,
    pub status_name: String,
    pub status_category: JiraStatusCategory,
    pub issue_type: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
}

impl JiraStatusCategory {
    /// Classify a JIRA status-category key/name, or — when no category is present —
    /// a raw status name, into our coarse buckets. Mirrors the token logic that was
    /// inline in `jira::map_category`, shared so the acli and REST paths agree.
    pub fn from_token(token: &str) -> Self {
        let token = token.to_ascii_lowercase();
        if token.contains("done") {
            JiraStatusCategory::Done
        } else if token.contains("progress") || token.contains("indeterminate") {
            JiraStatusCategory::InProgress
        } else if token.contains("new") || token.contains("to do") || token.contains("todo") {
            JiraStatusCategory::ToDo
        } else {
            JiraStatusCategory::Unknown
        }
    }
}

/// A legal transition for a work item (from `GET /issue/{key}/transitions`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransition {
    pub id: String,
    pub name: String,
    pub to_status_name: String,
    pub to_status_category: JiraStatusCategory,
}

/// A status defined in a project's workflow (from `GET /project/{key}/statuses`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraStatusDef {
    pub id: String,
    pub name: String,
    pub category: JiraStatusCategory,
}

/// REST connection state for the optional API-token layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraRestStatus {
    pub connected: bool,
    pub site: Option<String>,
    pub email: Option<String>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_from_token_classifies() {
        let cases = [
            ("done", JiraStatusCategory::Done),
            ("In Progress", JiraStatusCategory::InProgress),
            ("indeterminate", JiraStatusCategory::InProgress),
            ("To Do", JiraStatusCategory::ToDo),
            ("new", JiraStatusCategory::ToDo),
            ("Backlog", JiraStatusCategory::Unknown),
        ];
        for (token, expected) in cases {
            assert_eq!(JiraStatusCategory::from_token(token), expected, "token: {token}");
        }
    }
}
