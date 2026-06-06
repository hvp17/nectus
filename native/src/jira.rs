use crate::models::{JiraProject, JiraStatus, JiraStatusCategory, JiraWorkItem};
use crate::process_util::{command_error, resolve_executable};
use serde::{Deserialize, Deserializer};
use std::process::{Command, Output};

/// Build the board JQL from the structured UI selections, so the user never types
/// JQL. `project` is required; the flags add the usual board filters. Ordering by
/// `updated` (rather than `rank`) avoids errors on projects without a ranked board.
pub fn build_board_jql(
    project: &str,
    my_issues: bool,
    unresolved: bool,
    current_sprint: bool,
) -> String {
    let mut clauses = vec![format!("project = \"{}\"", project.replace('"', "\\\""))];
    if my_issues {
        clauses.push("assignee = currentUser()".to_string());
    }
    if unresolved {
        clauses.push("statusCategory != Done".to_string());
    }
    if current_sprint {
        clauses.push("sprint in openSprints()".to_string());
    }
    format!("{} ORDER BY updated DESC", clauses.join(" AND "))
}

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
    // acli's `url`, when present, is a real link; its `self` is the REST API
    // endpoint (…/rest/api/3/issue/<id>), which is not user-facing, so `self` is
    // intentionally ignored. The UI builds the browse URL from site + key.
    url: Option<String>,
}

// Field-type audit (the class of bug behind `invalid type: map, expected a
// string`): every scalar we read from `acli` was checked against whether v3
// could send an object/array instead. `summary`, `status.name`,
// `statusCategory.{key,name}`, `issuetype.name`, `priority.name`, and the
// `assignee.*` strings are plain JIRA system fields and are always scalars.
// The only object-where-we-expected-a-scalar field is `description` — and any
// other rich-text field (a comment body, `environment`, a rich-text custom
// field) would be ADF too, so route those through `deserialize_rich_text`
// rather than typing them `Option<String>`. Real shapes are pinned by the
// golden fixtures in `native/src/jira_fixtures/`.
#[derive(Debug, Deserialize)]
struct RawFields {
    summary: Option<String>,
    status: Option<RawStatus>,
    // JIRA Cloud's v3 API (`acli jira workitem view --json`) returns `description`
    // as an Atlassian Document Format object, while search/older outputs give a
    // plain string or null. Accept all three; an object is flattened to text.
    #[serde(default, deserialize_with = "deserialize_rich_text")]
    description: Option<String>,
    issuetype: Option<RawNamed>,
    priority: Option<RawNamed>,
    assignee: Option<RawAssignee>,
}

/// Deserialize a JIRA rich-text field that may arrive as a plain string, `null`,
/// or an Atlassian Document Format (ADF) object. Strings pass through, an ADF
/// document is flattened to plain text, and anything else (or empty) becomes
/// `None`, so a shape drift degrades gracefully instead of failing the parse.
fn deserialize_rich_text<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(rich_text_to_string))
}

fn rich_text_to_string(value: serde_json::Value) -> Option<String> {
    let text = match value {
        serde_json::Value::String(text) => text,
        serde_json::Value::Object(_) => {
            let mut text = String::new();
            collect_adf_text(&value, &mut text);
            text
        }
        _ => return None,
    };
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Walk an ADF node tree, appending text-node content and inserting newlines at
/// block and hard-break boundaries so the flattened text stays readable.
fn collect_adf_text(node: &serde_json::Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(serde_json::Value::as_str) {
        out.push_str(text);
    }
    let node_type = node.get("type").and_then(serde_json::Value::as_str);
    if node_type == Some("hardBreak") {
        out.push('\n');
    }
    if let Some(content) = node.get("content").and_then(serde_json::Value::as_array) {
        for child in content {
            collect_adf_text(child, out);
        }
        // Separate adjacent block nodes (paragraphs, headings, list items, …)
        // with a newline; the wrapping `doc` node adds none.
        if matches!(
            node_type,
            Some(
                "paragraph"
                    | "heading"
                    | "listItem"
                    | "blockquote"
                    | "codeBlock"
                    | "rule"
            )
        ) {
            out.push('\n');
        }
    }
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
    let priority = fields
        .as_ref()
        .and_then(|f| f.priority.as_ref())
        .and_then(|p| p.name.clone())
        // JIRA uses "None" for unset priority; treat it as no priority.
        .filter(|name| !name.eq_ignore_ascii_case("none"));
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
        priority,
        assignee,
        url: raw.url,
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

/// Parse `acli jira project list --json` into key/name pairs. Tolerant of a
/// top-level array or an object wrapping the list, and of missing names.
pub fn parse_projects(json: &str) -> Result<Vec<JiraProject>, String> {
    #[derive(Deserialize)]
    struct RawProject {
        key: Option<String>,
        name: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Projects {
        List(Vec<RawProject>),
        Wrapped {
            #[serde(alias = "projects", alias = "values", alias = "results")]
            items: Vec<RawProject>,
        },
    }
    let parsed: Projects =
        serde_json::from_str(json).map_err(|error| format!("Failed to parse projects: {error}"))?;
    let raw = match parsed {
        Projects::List(items) => items,
        Projects::Wrapped { items } => items,
    };
    Ok(raw
        .into_iter()
        .filter_map(|project| {
            let key = project.key?;
            let name = project.name.unwrap_or_else(|| key.clone());
            Some(JiraProject { key, name })
        })
        .collect())
}

/// Parse a single work item from `acli jira workitem view --json`.
pub fn parse_work_item(json: &str) -> Result<JiraWorkItem, String> {
    let raw: RawWorkItem = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse work item: {error}"))?;
    work_item_from_raw(raw).ok_or_else(|| "Work item is missing its key".to_string())
}

/// The work item types the create UI offers. `acli` cannot enumerate a project's
/// configured issue types, so this is the common default set; an invalid type for
/// a given project surfaces as an `acli` error (the optimistic pattern used across
/// the JIRA integration).
pub const DEFAULT_WORK_ITEM_TYPES: [&str; 4] = ["Task", "Bug", "Story", "Epic"];

/// Build the `acli jira workitem create` argument list from the structured form.
/// Kept pure (no shell-out) so the flag assembly is unit-tested. Optional fields
/// are omitted entirely when blank, and labels are trimmed and comma-joined the
/// way `acli --label` expects.
fn build_create_args<'a>(
    project: &'a str,
    issue_type: &'a str,
    summary: &'a str,
    description: Option<&'a str>,
    assignee: Option<&'a str>,
    labels: &'a str,
) -> Vec<String> {
    let mut args = vec![
        "jira".to_string(),
        "workitem".to_string(),
        "create".to_string(),
        "--project".to_string(),
        project.to_string(),
        "--type".to_string(),
        issue_type.to_string(),
        "--summary".to_string(),
        summary.to_string(),
        "--json".to_string(),
    ];
    if let Some(description) = description.map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--description".to_string());
        args.push(description.to_string());
    }
    if let Some(assignee) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--assignee".to_string());
        args.push(assignee.to_string());
    }
    let labels = labels
        .split(',')
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>()
        .join(",");
    if !labels.is_empty() {
        args.push("--label".to_string());
        args.push(labels);
    }
    args
}

/// Find the new issue key from `acli jira workitem create --json` output. Prefers
/// the structured `key` field, then a key embedded in the returned URL, then any
/// `ABC-123`-shaped token in the raw output, so a shape drift still recovers the key.
fn parse_created_key(stdout: &str) -> Option<String> {
    if let Ok(raw) = serde_json::from_str::<RawWorkItem>(stdout) {
        if let Some(key) = raw.key {
            return Some(key);
        }
        if let Some(key) = raw.url.as_deref().and_then(key_from_text) {
            return Some(key);
        }
    }
    key_from_text(stdout)
}

/// Scan free text for the first JIRA issue key (`PROJ-123`: an uppercase/digit
/// prefix of length >= 2 starting with a letter, a dash, then digits).
fn key_from_text(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .find_map(|token| {
            let (prefix, number) = token.split_once('-')?;
            let prefix_ok = prefix.len() >= 2
                && prefix.starts_with(|c: char| c.is_ascii_uppercase())
                && prefix
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
            let number_ok = !number.is_empty() && number.chars().all(|c| c.is_ascii_digit());
            (prefix_ok && number_ok).then(|| token.to_string())
        })
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

/// List the JIRA projects visible to the user, to populate the board's project
/// picker (so no JQL has to be typed).
pub fn list_projects() -> Result<Vec<JiraProject>, String> {
    let output = run_acli(&["jira", "project", "list", "--json", "--limit", "100"])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira project list failed"));
    }
    parse_projects(&String::from_utf8_lossy(&output.stdout))
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

/// Create a work item in JIRA, then re-fetch it so the caller gets a fully
/// populated `JiraWorkItem` (status, type, assignee) to open in the board panel.
/// `acli`'s create `--json` output only reliably carries the new key, so the
/// second `view` call fills in the rest. Optional fields (description, assignee,
/// labels) are omitted when blank.
pub fn create(
    project: &str,
    issue_type: &str,
    summary: &str,
    description: Option<&str>,
    assignee: Option<&str>,
    labels: &str,
) -> Result<JiraWorkItem, String> {
    let args = build_create_args(project, issue_type, summary, description, assignee, labels);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_acli(&arg_refs)?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem create failed"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let key = parse_created_key(&stdout).ok_or_else(|| {
        format!(
            "Work item created but its key could not be read from acli output: {}",
            stdout.trim()
        )
    })?;
    view(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_array_with_fields() {
        let json = r#"[
          {"key":"PROJ-1","fields":{"summary":"Login bug","status":{"name":"In Progress","statusCategory":{"key":"indeterminate","name":"In Progress"}},"issuetype":{"name":"Bug"},"priority":{"name":"High"},"assignee":{"displayName":"Ada"}}},
          {"key":"PROJ-2","fields":{"summary":"Docs","status":{"name":"Done","statusCategory":{"key":"done","name":"Done"}},"priority":{"name":"None"}}}
        ]"#;
        let items = parse_work_items(json).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].key, "PROJ-1");
        assert_eq!(items[0].summary, "Login bug");
        assert_eq!(items[0].status_name, "In Progress");
        assert_eq!(items[0].status_category, JiraStatusCategory::InProgress);
        assert_eq!(items[0].issue_type.as_deref(), Some("Bug"));
        assert_eq!(items[0].priority.as_deref(), Some("High"));
        assert_eq!(items[0].assignee.as_deref(), Some("Ada"));
        assert_eq!(items[1].status_category, JiraStatusCategory::Done);
        // A literal "None" priority is treated as unset.
        assert_eq!(items[1].priority, None);
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
    fn parses_view_with_adf_description() {
        // JIRA Cloud's v3 API (what `acli jira workitem view --json` returns)
        // carries `description` as an Atlassian Document Format object, not a
        // string. Flatten it to plain text instead of failing the parse.
        let json = r#"{
          "key":"SCRUM-5",
          "fields":{
            "summary":"qweqwe",
            "description":{
              "type":"doc",
              "version":1,
              "content":[
                {"type":"paragraph","content":[{"type":"text","text":"First line"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Second line"}]}
              ]
            },
            "status":{"name":"To Do","statusCategory":{"key":"new"}}
          }
        }"#;
        let item = parse_work_item(json).unwrap();
        assert_eq!(item.key, "SCRUM-5");
        assert_eq!(item.summary, "qweqwe");
        assert_eq!(item.description.as_deref(), Some("First line\nSecond line"));
    }

    #[test]
    fn parses_view_with_null_description() {
        let json = r#"{"key":"V-2","fields":{"summary":"No body","description":null,"status":{"name":"To Do","statusCategory":{"key":"new"}}}}"#;
        let item = parse_work_item(json).unwrap();
        assert_eq!(item.description, None);
    }

    // Golden-fixture tests: real `acli ... --json` output (scrubbed) from
    // `native/src/jira_fixtures/`. These guard against the actual CLI shape
    // drifting from our structs — the hand-written tests above can only encode
    // our assumptions, so the recurrence guard has to come from captured output.
    // See `native/src/jira_fixtures/README.md` to refresh after an `acli` upgrade.

    #[test]
    fn real_acli_view_with_assignee_parses() {
        let json = include_str!("jira_fixtures/view_with_assignee.json");
        let item = parse_work_item(json).unwrap();
        assert_eq!(item.key, "SCRUM-3");
        assert_eq!(item.summary, "Title of work");
        assert_eq!(item.status_name, "To Do");
        assert_eq!(item.status_category, JiraStatusCategory::ToDo);
        assert_eq!(item.issue_type.as_deref(), Some("Task"));
        // The view payload carries no `priority` field for these items.
        assert_eq!(item.priority, None);
        assert_eq!(item.assignee.as_deref(), Some("Test User"));
        // `description` arrives as an ADF object and is flattened to plain text.
        assert_eq!(item.description.as_deref(), Some("Description"));
    }

    #[test]
    fn real_acli_view_simple_parses() {
        let json = include_str!("jira_fixtures/view_simple.json");
        let item = parse_work_item(json).unwrap();
        assert_eq!(item.key, "SCRUM-5");
        assert_eq!(item.summary, "qweqwe");
        assert_eq!(item.status_category, JiraStatusCategory::ToDo);
        assert_eq!(item.assignee, None);
        assert_eq!(item.description.as_deref(), Some("ewqweqew"));
    }

    #[test]
    fn real_acli_search_parses_board() {
        let json = include_str!("jira_fixtures/search.json");
        let items = parse_work_items(json).unwrap();
        assert_eq!(
            items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(),
            ["SCRUM-5", "SCRUM-4", "SCRUM-3"]
        );
        for item in &items {
            assert_eq!(item.status_category, JiraStatusCategory::ToDo);
            assert_eq!(item.priority.as_deref(), Some("Medium"));
            // `search` omits `description` entirely (the board path never breaks).
            assert_eq!(item.description, None);
        }
        // The second item is assigned; the first is not.
        assert_eq!(items[0].assignee, None);
        assert_eq!(items[1].assignee.as_deref(), Some("Test User"));
    }

    #[test]
    fn real_acli_project_list_parses() {
        let json = include_str!("jira_fixtures/project_list.json");
        let projects = parse_projects(json).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].key, "SCRUM");
        assert_eq!(projects[0].name, "My Software Team");
    }

    #[test]
    fn builds_board_jql_from_project_only() {
        assert_eq!(
            build_board_jql("ENG", false, false, false),
            "project = \"ENG\" ORDER BY updated DESC"
        );
    }

    #[test]
    fn builds_board_jql_with_all_filters() {
        assert_eq!(
            build_board_jql("ENG", true, true, true),
            "project = \"ENG\" AND assignee = currentUser() AND statusCategory != Done AND sprint in openSprints() ORDER BY updated DESC"
        );
    }

    #[test]
    fn builds_board_jql_escapes_quotes_in_project_key() {
        assert_eq!(
            build_board_jql("A\"B", false, true, false),
            "project = \"A\\\"B\" AND statusCategory != Done ORDER BY updated DESC"
        );
    }

    #[test]
    fn parses_project_list_array_and_wrapped() {
        let array = r#"[{"key":"ENG","name":"Engineering"},{"key":"OPS"}]"#;
        let projects = parse_projects(array).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].key, "ENG");
        assert_eq!(projects[0].name, "Engineering");
        // Missing name falls back to the key.
        assert_eq!(projects[1].name, "OPS");

        let wrapped = r#"{"projects":[{"key":"PROJ","name":"Project"}]}"#;
        assert_eq!(parse_projects(wrapped).unwrap()[0].key, "PROJ");
    }

    #[test]
    fn builds_create_args_minimal() {
        let args = build_create_args("ENG", "Task", "Login bug", None, None, "");
        assert_eq!(
            args,
            vec![
                "jira",
                "workitem",
                "create",
                "--project",
                "ENG",
                "--type",
                "Task",
                "--summary",
                "Login bug",
                "--json"
            ]
        );
    }

    #[test]
    fn builds_create_args_with_all_fields_and_trims_labels() {
        let args = build_create_args(
            "ENG",
            "Bug",
            "Crash",
            Some("Steps to reproduce"),
            Some("user@example.com"),
            " api , , crash ",
        );
        assert_eq!(
            args,
            vec![
                "jira",
                "workitem",
                "create",
                "--project",
                "ENG",
                "--type",
                "Bug",
                "--summary",
                "Crash",
                "--json",
                "--description",
                "Steps to reproduce",
                "--assignee",
                "user@example.com",
                "--label",
                "api,crash",
            ]
        );
    }

    #[test]
    fn builds_create_args_omits_blank_optionals() {
        let args = build_create_args("ENG", "Story", "Thing", Some("   "), Some(""), "  ,  ");
        // Blank description/assignee/labels add no flags.
        assert!(!args.iter().any(|a| a == "--description"));
        assert!(!args.iter().any(|a| a == "--assignee"));
        assert!(!args.iter().any(|a| a == "--label"));
    }

    #[test]
    fn parse_created_key_prefers_json_key() {
        assert_eq!(
            parse_created_key(r#"{"key":"ENG-42","summary":"x"}"#),
            Some("ENG-42".to_string())
        );
    }

    #[test]
    fn parse_created_key_from_url_and_plain_text() {
        assert_eq!(
            parse_created_key(r#"{"url":"https://acme.atlassian.net/browse/ENG-7"}"#),
            Some("ENG-7".to_string())
        );
        assert_eq!(
            parse_created_key("Created work item ENG-100"),
            Some("ENG-100".to_string())
        );
        assert_eq!(parse_created_key("no key here"), None);
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
