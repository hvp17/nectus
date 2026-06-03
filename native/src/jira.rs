use crate::models::{JiraStatus, JiraStatusCategory, JiraWorkItem};
use crate::process_util::{command_error, resolve_executable};
use serde::Deserialize;
use std::process::{Command, Output};

/// Tolerant raw shape of a work item from `acli jira workitem search --json` /
/// `view --json`. Field names follow the documented `acli` output; every field
/// is optional and unknown extras are ignored, so a shape drift degrades
/// gracefully (one bad item is dropped) rather than failing the whole board.
#[derive(Debug, Deserialize)]
struct RawWorkItem {
    key: Option<String>,
    #[serde(default)]
    fields: Option<RawFields>,
    // Some acli outputs flatten summary/status at the top level; accept both.
    summary: Option<String>,
    status: Option<RawStatus>,
    url: Option<String>,
    #[serde(rename = "self")]
    self_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFields {
    summary: Option<String>,
    status: Option<RawStatus>,
    description: Option<String>,
    issuetype: Option<RawNamed>,
    assignee: Option<RawAssignee>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawStatus {
    name: Option<String>,
    #[serde(rename = "statusCategory")]
    status_category: Option<RawStatusCategory>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawStatusCategory {
    key: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawNamed {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAssignee {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    name: Option<String>,
    #[serde(rename = "emailAddress")]
    email: Option<String>,
}

fn map_category(raw: Option<&RawStatusCategory>) -> JiraStatusCategory {
    let token = raw
        .and_then(|c| c.key.as_deref().or(c.name.as_deref()))
        .unwrap_or("")
        .to_ascii_lowercase();
    // JIRA status categories: "new"/"to do", "indeterminate"/"in progress", "done".
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

fn work_item_from_raw(raw: RawWorkItem) -> Option<JiraWorkItem> {
    let key = raw.key?;
    let fields = raw.fields;
    let summary = raw
        .summary
        .or_else(|| fields.as_ref().and_then(|f| f.summary.clone()))
        .unwrap_or_default();
    let status = raw
        .status
        .or_else(|| fields.as_ref().and_then(|f| f.status.clone()));
    let status_name = status
        .as_ref()
        .and_then(|s| s.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());
    let status_category = map_category(status.as_ref().and_then(|s| s.status_category.as_ref()));
    let issue_type = fields
        .as_ref()
        .and_then(|f| f.issuetype.as_ref())
        .and_then(|t| t.name.clone());
    let assignee = fields
        .as_ref()
        .and_then(|f| f.assignee.as_ref())
        .and_then(|a| {
            a.display_name
                .clone()
                .or_else(|| a.name.clone())
                .or_else(|| a.email.clone())
        });
    let description = fields.as_ref().and_then(|f| f.description.clone());
    Some(JiraWorkItem {
        key,
        summary,
        status_name,
        status_category,
        issue_type,
        assignee,
        url: raw.url.or(raw.self_url),
        description,
    })
}

/// Parse `acli jira workitem search --json`. Accepts either a top-level array or
/// an object wrapping the array under a common key.
pub fn parse_work_items(json: &str) -> Result<Vec<JiraWorkItem>, String> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Search {
        List(Vec<RawWorkItem>),
        Wrapped {
            #[serde(
                alias = "workItems",
                alias = "issues",
                alias = "values",
                alias = "results"
            )]
            items: Vec<RawWorkItem>,
        },
    }
    let parsed: Search = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse work items: {error}"))?;
    let raw = match parsed {
        Search::List(items) => items,
        Search::Wrapped { items } => items,
    };
    Ok(raw.into_iter().filter_map(work_item_from_raw).collect())
}

/// Parse a single work item from `acli jira workitem view --json`.
pub fn parse_work_item(json: &str) -> Result<JiraWorkItem, String> {
    let raw: RawWorkItem = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse work item: {error}"))?;
    work_item_from_raw(raw).ok_or_else(|| "Work item is missing its key".to_string())
}

/// Extract the active site host from `acli jira auth status` text output.
pub fn parse_auth_site(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == '/' || c == '"' || c == '\'')
        .find(|token| token.ends_with(".atlassian.net") && token.len() > ".atlassian.net".len())
        .map(str::to_string)
}

fn run_acli(args: &[&str]) -> Result<Output, String> {
    // Resolve `acli` against PATH + common install dirs (a GUI-launched macOS app
    // gets a minimal PATH). Like `gh`, `acli` is a single binary that spawns no
    // node, so it needs resolution but not `augmented_path`.
    Command::new(resolve_executable("acli"))
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Atlassian CLI (acli) is not installed".to_string()
            } else {
                format!("Failed to run acli: {error}")
            }
        })
}

/// Report whether `acli` is installed, authenticated, and the active site.
/// Never errors — a missing `acli` reports `installed: false`.
pub fn status() -> JiraStatus {
    let installed = run_acli(&["--version"])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !installed {
        return JiraStatus {
            installed: false,
            authenticated: false,
            account: None,
            site: None,
        };
    }
    let auth = run_acli(&["jira", "auth", "status"]);
    let authenticated = auth
        .as_ref()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let site = auth
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| parse_auth_site(&String::from_utf8_lossy(&output.stdout)));
    JiraStatus {
        installed: true,
        authenticated,
        account: site.clone(),
        site,
    }
}

/// Load the board: search work items by JQL.
pub fn search(jql: &str, limit: u32) -> Result<Vec<JiraWorkItem>, String> {
    let limit = limit.to_string();
    let output = run_acli(&[
        "jira", "workitem", "search", "--jql", jql, "--json", "--limit", &limit,
    ])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem search failed"));
    }
    parse_work_items(&String::from_utf8_lossy(&output.stdout))
}

/// View a single work item (used to backfill a story description).
pub fn view(key: &str) -> Result<JiraWorkItem, String> {
    let output = run_acli(&["jira", "workitem", "view", key, "--json"])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem view failed"));
    }
    parse_work_item(&String::from_utf8_lossy(&output.stdout))
}

/// Transition a work item to a target status. Optimistic: JIRA rejects illegal
/// workflow moves with a non-zero exit, surfaced here as an `Err` so the UI can
/// revert the card.
pub fn transition(key: &str, status: &str) -> Result<(), String> {
    let output = run_acli(&[
        "jira",
        "workitem",
        "transition",
        "--key",
        key,
        "--status",
        status,
        "--yes",
    ])?;
    if !output.status.success() {
        return Err(command_error(
            &output,
            "acli jira workitem transition failed",
        ));
    }
    Ok(())
}

pub fn assign(key: &str, assignee: &str) -> Result<(), String> {
    let output = run_acli(&[
        "jira",
        "workitem",
        "assign",
        "--key",
        key,
        "--assignee",
        assignee,
    ])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem assign failed"));
    }
    Ok(())
}

pub fn comment(key: &str, body: &str) -> Result<(), String> {
    let output = run_acli(&["jira", "workitem", "comment", "--key", key, "--body", body])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem comment failed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_array_with_fields() {
        let json = r#"[
          {"key":"PROJ-1","fields":{"summary":"Login bug","status":{"name":"In Progress","statusCategory":{"key":"indeterminate","name":"In Progress"}},"issuetype":{"name":"Bug"},"assignee":{"displayName":"Ada"}}},
          {"key":"PROJ-2","fields":{"summary":"Docs","status":{"name":"Done","statusCategory":{"key":"done","name":"Done"}}}}
        ]"#;
        let items = parse_work_items(json).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].key, "PROJ-1");
        assert_eq!(items[0].summary, "Login bug");
        assert_eq!(items[0].status_name, "In Progress");
        assert_eq!(items[0].status_category, JiraStatusCategory::InProgress);
        assert_eq!(items[0].issue_type.as_deref(), Some("Bug"));
        assert_eq!(items[0].assignee.as_deref(), Some("Ada"));
        assert_eq!(items[1].status_category, JiraStatusCategory::Done);
    }

    #[test]
    fn parses_wrapped_object_and_flat_fields() {
        let json = r#"{"workItems":[{"key":"T-9","summary":"Flat","status":{"name":"To Do","statusCategory":{"key":"new"}}}]}"#;
        let items = parse_work_items(json).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].summary, "Flat");
        assert_eq!(items[0].status_category, JiraStatusCategory::ToDo);
    }

    #[test]
    fn drops_items_without_a_key_but_keeps_the_rest() {
        let json = r#"[{"summary":"no key"},{"key":"K-1","fields":{"summary":"ok","status":{"name":"New","statusCategory":{"key":"new"}}}}]"#;
        let items = parse_work_items(json).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].key, "K-1");
    }

    #[test]
    fn unknown_category_falls_back() {
        let json = r#"[{"key":"K-2","fields":{"summary":"x","status":{"name":"Weird"}}}]"#;
        let items = parse_work_items(json).unwrap();
        assert_eq!(items[0].status_category, JiraStatusCategory::Unknown);
        assert_eq!(items[0].status_name, "Weird");
    }

    #[test]
    fn parses_single_view() {
        let json = r#"{"key":"V-1","fields":{"summary":"View me","description":"details","status":{"name":"Done","statusCategory":{"key":"done"}}}}"#;
        let item = parse_work_item(json).unwrap();
        assert_eq!(item.key, "V-1");
        assert_eq!(item.description.as_deref(), Some("details"));
    }

    #[test]
    fn parse_site_from_auth_status() {
        assert_eq!(
            parse_auth_site("Logged in to mary.atlassian.net as Mary"),
            Some("mary.atlassian.net".to_string())
        );
        assert_eq!(
            parse_auth_site("Account: https://acme.atlassian.net/"),
            Some("acme.atlassian.net".to_string())
        );
        assert_eq!(parse_auth_site("Not logged in"), None);
    }
}
