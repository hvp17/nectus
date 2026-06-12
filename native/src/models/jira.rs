use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

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
    /// Parent epic key, when known. Populated by the Agile-API sprint path (and any
    /// search that requests the `epic`/`parent` fields); `None` on the plain board
    /// search, which does not request them.
    #[serde(default)]
    pub epic_key: Option<String>,
    /// Parent epic name/summary, when known. Same provenance as `epic_key`.
    #[serde(default)]
    pub epic_name: Option<String>,
}

/// A sprint from the Agile REST API (`/rest/agile/1.0/board/{id}/sprint`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraSprint {
    pub id: i64,
    pub name: String,
    /// JIRA sprint state: `active`, `future`, or `closed`.
    pub state: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub goal: Option<String>,
}

/// One row of the sprint board: a sprint and its issues, or the backlog when
/// `sprint` is `None`. Issues carry their `epic_key`/`epic_name` so the UI can
/// group each lane into epic swimlanes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JiraSprintLane {
    pub sprint: Option<JiraSprint>,
    pub items: Vec<JiraWorkItem>,
}

impl JiraStatusCategory {
    /// Classify a JIRA status-category key/name, or — when no category is present —
    /// a raw status name, into our coarse buckets. Shared by every payload parser
    /// (`jira::map_category`, the REST transition/status parsers) so they agree.
    pub fn from_token(token: &str) -> Self {
        // Match whole words, not substrings, so e.g. "Abandoned" doesn't match
        // "done". Splitting on non-alphanumerics also handles "To Do" → ["to","do"].
        let lowered = token.to_ascii_lowercase();
        let words: Vec<&str> = lowered
            .split(|c: char| !c.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect();
        let has = |word: &str| words.contains(&word);
        if has("done") {
            JiraStatusCategory::Done
        } else if has("progress") || has("indeterminate") {
            JiraStatusCategory::InProgress
        } else if has("new") || has("todo") || (has("to") && has("do")) {
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

/// JIRA connection state: whether an API token is connected for the configured
/// site + email (the token itself stays in the Keychain).
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
            // "Abandoned" must not match the "done" substring → Unknown, not Done.
            ("Abandoned", JiraStatusCategory::Unknown),
        ];
        for (token, expected) in cases {
            assert_eq!(
                JiraStatusCategory::from_token(token),
                expected,
                "token: {token}"
            );
        }
    }
}
