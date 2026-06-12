//! JIRA Cloud REST client — the app's JIRA integration, gated on the user's API
//! token (Settings → JIRA). The HTTP wrappers are thin; the JSON shape handling
//! lives in pure parse functions (here and in `native/src/jira.rs`) that are
//! unit-tested against golden fixtures.

use crate::models::{
    JiraProject, JiraSprint, JiraSprintLane, JiraStatusCategory, JiraStatusDef, JiraTransition,
    JiraWorkItem,
};
use base64::Engine;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

/// Shared `ureq` agent with bounded timeouts. All REST calls run inside a
/// `spawn_blocking` worker, so without these a connect-but-never-respond JIRA
/// host would pin that thread forever. Built once and reused.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(30))
            .timeout_write(Duration::from_secs(30))
            .build()
    })
}

#[derive(Deserialize)]
struct RawTransitions {
    transitions: Vec<RawTransition>,
}
#[derive(Deserialize)]
struct RawTransition {
    id: String,
    name: String,
    to: Option<RawTo>,
}
#[derive(Deserialize)]
struct RawTo {
    name: Option<String>,
    #[serde(rename = "statusCategory")]
    status_category: Option<RawCategory>,
}
#[derive(Deserialize)]
struct RawCategory {
    key: Option<String>,
    name: Option<String>,
}
#[derive(Deserialize)]
struct RawIssueTypeStatuses {
    statuses: Option<Vec<RawStatus>>,
}
#[derive(Deserialize)]
struct RawStatus {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "statusCategory")]
    status_category: Option<RawCategory>,
}

fn category_of(name: &str, raw: Option<&RawCategory>) -> JiraStatusCategory {
    // Prefer the explicit category token; fall back to the status name when the
    // category is absent (some `/project/statuses` rows omit it).
    let token = raw
        .and_then(|c| c.key.as_deref().or(c.name.as_deref()))
        .unwrap_or(name);
    JiraStatusCategory::from_token(token)
}

/// Parse `GET /rest/api/3/issue/{key}/transitions`. Drops transitions with no
/// target status name (unusable for a status move).
pub fn parse_transitions(json: &str) -> Result<Vec<JiraTransition>, String> {
    let raw: RawTransitions = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse transitions: {error}"))?;
    Ok(raw
        .transitions
        .into_iter()
        .filter_map(|t| {
            let to = t.to?;
            let to_status_name = to.name?;
            let to_status_category = category_of(&to_status_name, to.status_category.as_ref());
            Some(JiraTransition {
                id: t.id,
                name: t.name,
                to_status_name,
                to_status_category,
            })
        })
        .collect())
}

/// Parse `GET /rest/api/3/project/{key}/statuses` — an array of issue types each
/// with a `statuses` list. Unions statuses across issue types, de-duplicating by
/// status id, preserving first-seen order.
pub fn parse_project_statuses(json: &str) -> Result<Vec<JiraStatusDef>, String> {
    let raw: Vec<RawIssueTypeStatuses> = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse project statuses: {error}"))?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for issue_type in raw {
        for status in issue_type.statuses.unwrap_or_default() {
            let (Some(id), Some(name)) = (status.id, status.name) else {
                continue;
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let category = category_of(&name, status.status_category.as_ref());
            out.push(JiraStatusDef { id, name, category });
        }
    }
    Ok(out)
}

fn auth_header(email: &str, token: &str) -> String {
    let raw = format!("{email}:{token}");
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw)
    )
}

/// Reduce a site to a bare host before building a URL. The token card asks for a
/// bare host, but a `jira_site_url` set elsewhere (e.g. an earlier board config)
/// can carry an `https://` scheme and/or a trailing slash; left as-is that would
/// yield a malformed `https://https://host/...` REST URL.
fn normalize_site(site: &str) -> String {
    site.trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

fn base(site: &str) -> String {
    format!("https://{}/rest/api/3", normalize_site(site))
}

/// Agile (software) REST base. Sprints, boards, and the backlog live under
/// `/rest/agile/1.0`, not the `/rest/api/3` core API.
fn agile_base(site: &str) -> String {
    format!("https://{}/rest/agile/1.0", normalize_site(site))
}

/// GET an absolute URL with Basic auth, returning the body as a string. Shared by
/// the core-API and Agile-API helpers.
fn get_url(url: &str, email: &str, token: &str) -> Result<String, String> {
    match agent()
        .get(url)
        .set("Authorization", &auth_header(email, token))
        .set("Accept", "application/json")
        .call()
    {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("Failed to read JIRA response: {error}")),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!("JIRA request failed ({code}): {}", body.trim()))
        }
        Err(error) => Err(format!("JIRA request error: {error}")),
    }
}

/// Send a JSON body with Basic auth (POST/PUT), returning the response body as a
/// string (empty for 204s). Shared by every REST write.
fn send_json(
    method: &str,
    url: &str,
    email: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    match agent()
        .request(method, url)
        .set("Authorization", &auth_header(email, token))
        .set("Accept", "application/json")
        .send_json(body)
    {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("Failed to read JIRA response: {error}")),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!("JIRA request failed ({code}): {}", body.trim()))
        }
        Err(error) => Err(format!("JIRA request error: {error}")),
    }
}

/// Percent-encode a query-string value (RFC 3986 unreserved characters pass
/// through). Tiny on purpose — only the user-search query needs it.
fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn get(site: &str, email: &str, token: &str, path: &str) -> Result<String, String> {
    get_url(&format!("{}{path}", base(site)), email, token)
}

fn post(
    site: &str,
    email: &str,
    token: &str,
    path: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    send_json("POST", &format!("{}{path}", base(site)), email, token, body)
}

fn put(
    site: &str,
    email: &str,
    token: &str,
    path: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    send_json("PUT", &format!("{}{path}", base(site)), email, token, body)
}

fn get_agile(site: &str, email: &str, token: &str, path: &str) -> Result<String, String> {
    get_url(&format!("{}{path}", agile_base(site)), email, token)
}

/// Validate credentials via `GET /myself`.
pub fn verify(site: &str, email: &str, token: &str) -> Result<(), String> {
    get(site, email, token, "/myself").map(|_| ())
}

pub fn list_transitions(
    site: &str,
    email: &str,
    token: &str,
    key: &str,
) -> Result<Vec<JiraTransition>, String> {
    let body = get(site, email, token, &format!("/issue/{key}/transitions"))?;
    parse_transitions(&body)
}

pub fn project_statuses(
    site: &str,
    email: &str,
    token: &str,
    project: &str,
) -> Result<Vec<JiraStatusDef>, String> {
    let body = get(site, email, token, &format!("/project/{project}/statuses"))?;
    parse_project_statuses(&body)
}

pub fn perform_transition(
    site: &str,
    email: &str,
    token: &str,
    key: &str,
    transition_id: &str,
) -> Result<(), String> {
    post(
        site,
        email,
        token,
        &format!("/issue/{key}/transitions"),
        ureq::json!({ "transition": { "id": transition_id } }),
    )
    .map(|_| ())
}

/// Id of the legal transition whose target status matches `status_name`
/// (case-insensitive). Pure, so the matching is unit-tested against the fixtures.
fn transition_id_for_status<'a>(
    transitions: &'a [JiraTransition],
    status_name: &str,
) -> Option<&'a str> {
    transitions
        .iter()
        .find(|transition| transition.to_status_name.eq_ignore_ascii_case(status_name))
        .map(|transition| transition.id.as_str())
}

/// Resolve `status_name` to a legal transition for `key` and perform it. Returns
/// an error when no legal transition matches the target status. Keeps the
/// list→match→perform algorithm out of the command layer (`lib.rs`).
pub fn transition_to_status(
    site: &str,
    email: &str,
    token: &str,
    key: &str,
    status_name: &str,
) -> Result<(), String> {
    let transitions = list_transitions(site, email, token, key)?;
    let transition_id = transition_id_for_status(&transitions, status_name).ok_or_else(|| {
        format!("No legal transition to \"{status_name}\" from the current status")
    })?;
    perform_transition(site, email, token, key, transition_id)
}

// ---- Core API: projects, search, view, assign, comment, create ------------

/// The issue fields a board/search card needs (no `description` — the work-item
/// view backfills it on open).
const BOARD_ISSUE_FIELDS: [&str; 5] = ["summary", "status", "issuetype", "priority", "assignee"];

/// List the JIRA projects visible to the user via `GET /project/search`. The
/// response wraps the page under `values`, which the shared tolerant parser accepts.
pub fn list_projects(site: &str, email: &str, token: &str) -> Result<Vec<JiraProject>, String> {
    let body = get(site, email, token, "/project/search?maxResults=100")?;
    crate::jira::parse_projects(&body)
}

/// `nextPageToken` from a `/search/jql` page (absent on the last page). Parsed
/// separately from the issues so `parse_work_items` stays payload-agnostic.
fn parse_next_page_token(json: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Page {
        #[serde(rename = "nextPageToken")]
        next_page_token: Option<String>,
    }
    serde_json::from_str::<Page>(json)
        .ok()
        .and_then(|page| page.next_page_token)
}

/// Search work items by JQL via `POST /search/jql` (the endpoint that replaced the
/// removed `/rest/api/3/search`), following `nextPageToken` pagination up to
/// `limit` items. The JQL travels in the body, so no URL encoding is needed.
pub fn search(
    site: &str,
    email: &str,
    token: &str,
    jql: &str,
    limit: u32,
) -> Result<Vec<JiraWorkItem>, String> {
    let limit = limit as usize;
    let mut items: Vec<JiraWorkItem> = Vec::new();
    let mut next_page_token: Option<String> = None;
    loop {
        let mut body = ureq::json!({
            "jql": jql,
            "maxResults": (limit - items.len()).min(100),
            "fields": BOARD_ISSUE_FIELDS,
        });
        if let Some(token_value) = &next_page_token {
            body["nextPageToken"] = ureq::json!(token_value);
        }
        let response = post(site, email, token, "/search/jql", body)?;
        let page = crate::jira::parse_work_items(&response)?;
        let page_len = page.len();
        items.extend(page);
        next_page_token = parse_next_page_token(&response);
        if next_page_token.is_none() || items.len() >= limit || page_len == 0 {
            break;
        }
    }
    items.truncate(limit);
    Ok(items)
}

/// Fetch a single work item via `GET /issue/{key}`, including its description
/// (ADF, flattened by the shared parser) for the story-attach backfill.
pub fn view(site: &str, email: &str, token: &str, key: &str) -> Result<JiraWorkItem, String> {
    let fields = format!("{},description", BOARD_ISSUE_FIELDS.join(","));
    let body = get(site, email, token, &format!("/issue/{key}?fields={fields}"))?;
    crate::jira::parse_work_item(&body)
}

#[derive(Deserialize)]
struct RawUser {
    #[serde(rename = "accountId")]
    account_id: Option<String>,
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "accountType")]
    account_type: Option<String>,
}

/// Pick the account id matching `query` from a `/user/search` result. Exact email
/// match wins, then exact display-name match, then a single unambiguous result;
/// app accounts (bots) are ignored. Pure, so the matching rules are unit-tested.
fn pick_account_id(users: &[RawUser], query: &str) -> Result<String, String> {
    let people: Vec<&RawUser> = users
        .iter()
        .filter(|user| {
            user.account_id.is_some()
                && !matches!(user.account_type.as_deref(), Some(kind) if kind.eq_ignore_ascii_case("app"))
        })
        .collect();
    let by = |predicate: &dyn Fn(&RawUser) -> bool| -> Option<String> {
        let mut matches = people.iter().filter(|user| predicate(user));
        let first = matches.next()?;
        // Two distinct accounts matching the same email/name is ambiguous.
        if matches.next().is_some() {
            return None;
        }
        first.account_id.clone()
    };
    if let Some(id) = by(&|user| {
        user.email_address
            .as_deref()
            .is_some_and(|email| email.eq_ignore_ascii_case(query))
    }) {
        return Ok(id);
    }
    if let Some(id) = by(&|user| {
        user.display_name
            .as_deref()
            .is_some_and(|name| name.eq_ignore_ascii_case(query))
    }) {
        return Ok(id);
    }
    match people.as_slice() {
        [only] => Ok(only.account_id.clone().expect("filtered to Some above")),
        [] => Err(format!("No JIRA user found matching \"{query}\"")),
        _ => Err(format!(
            "\"{query}\" matches multiple JIRA users; use their full email address"
        )),
    }
}

/// Resolve an assignee string (`@me`, an email, or a display name) to an
/// `accountId` — the assignee endpoint takes account ids, not emails.
fn resolve_account_id(
    site: &str,
    email: &str,
    token: &str,
    assignee: &str,
) -> Result<String, String> {
    let assignee = assignee.trim();
    if assignee.eq_ignore_ascii_case("@me") {
        #[derive(Deserialize)]
        struct Myself {
            #[serde(rename = "accountId")]
            account_id: Option<String>,
        }
        let body = get(site, email, token, "/myself")?;
        let myself: Myself = serde_json::from_str(&body)
            .map_err(|error| format!("Failed to parse /myself: {error}"))?;
        return myself
            .account_id
            .ok_or_else(|| "Your JIRA account has no accountId".to_string());
    }
    let body = get(
        site,
        email,
        token,
        &format!(
            "/user/search?query={}&maxResults=20",
            encode_query(assignee)
        ),
    )?;
    let users: Vec<RawUser> = serde_json::from_str(&body)
        .map_err(|error| format!("Failed to parse user search: {error}"))?;
    pick_account_id(&users, assignee)
}

/// Assign a work item via `PUT /issue/{key}/assignee`, resolving the assignee
/// string to an account id first.
pub fn assign(
    site: &str,
    email: &str,
    token: &str,
    key: &str,
    assignee: &str,
) -> Result<(), String> {
    let account_id = resolve_account_id(site, email, token, assignee)?;
    put(
        site,
        email,
        token,
        &format!("/issue/{key}/assignee"),
        ureq::json!({ "accountId": account_id }),
    )
    .map(|_| ())
}

/// Wrap plain text in a minimal Atlassian Document Format document (one paragraph
/// per line) — the inverse of the read-side `collect_adf_text` flattener. The v3
/// API rejects plain-string rich-text bodies.
fn text_to_adf(text: &str) -> serde_json::Value {
    let paragraphs: Vec<serde_json::Value> = text
        .split('\n')
        .map(|line| {
            if line.trim().is_empty() {
                // ADF forbids empty text nodes; an empty paragraph keeps the gap.
                ureq::json!({ "type": "paragraph", "content": [] })
            } else {
                ureq::json!({
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": line }],
                })
            }
        })
        .collect();
    ureq::json!({ "type": "doc", "version": 1, "content": paragraphs })
}

/// Comment on a work item via `POST /issue/{key}/comment` (ADF body).
pub fn comment(site: &str, email: &str, token: &str, key: &str, body: &str) -> Result<(), String> {
    post(
        site,
        email,
        token,
        &format!("/issue/{key}/comment"),
        ureq::json!({ "body": text_to_adf(body) }),
    )
    .map(|_| ())
}

/// Create a work item via `POST /issue`, then re-fetch it so the caller gets a
/// fully populated card (status, type, assignee) for the board panel.
#[allow(clippy::too_many_arguments)]
pub fn create(
    site: &str,
    email: &str,
    token: &str,
    project: &str,
    issue_type: &str,
    summary: &str,
    description: Option<&str>,
    assignee: Option<&str>,
    labels: &str,
) -> Result<JiraWorkItem, String> {
    let mut fields = ureq::json!({
        "project": { "key": project },
        "issuetype": { "name": issue_type },
        "summary": summary,
    });
    if let Some(description) = description.map(str::trim).filter(|value| !value.is_empty()) {
        fields["description"] = text_to_adf(description);
    }
    let labels: Vec<&str> = labels
        .split(',')
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .collect();
    if !labels.is_empty() {
        fields["labels"] = ureq::json!(labels);
    }
    if let Some(assignee) = assignee.map(str::trim).filter(|value| !value.is_empty()) {
        let account_id = resolve_account_id(site, email, token, assignee)?;
        fields["assignee"] = ureq::json!({ "id": account_id });
    }
    let response = post(
        site,
        email,
        token,
        "/issue",
        ureq::json!({ "fields": fields }),
    )?;
    #[derive(Deserialize)]
    struct Created {
        key: Option<String>,
    }
    let created: Created = serde_json::from_str(&response)
        .map_err(|error| format!("Failed to parse create response: {error}"))?;
    let key = created
        .key
        .ok_or_else(|| format!("Work item created but the response carried no key: {response}"))?;
    view(site, email, token, &key)
}

// ---- Agile API: boards, sprints, and the sprint board ----------------------

#[derive(Deserialize)]
struct RawBoards {
    values: Option<Vec<RawBoard>>,
}
#[derive(Deserialize)]
struct RawBoard {
    id: i64,
    #[serde(rename = "type")]
    board_type: Option<String>,
}

#[derive(Deserialize)]
struct RawSprints {
    values: Option<Vec<RawSprint>>,
}
#[derive(Deserialize)]
struct RawSprint {
    id: i64,
    name: Option<String>,
    state: Option<String>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    goal: Option<String>,
}

/// Pick the first scrum board id from `GET /board?...&type=scrum`. Returns `None`
/// when the project has no scrum board (only then are there no sprints to show).
fn parse_first_board_id(json: &str) -> Result<Option<i64>, String> {
    let raw: RawBoards =
        serde_json::from_str(json).map_err(|error| format!("Failed to parse boards: {error}"))?;
    Ok(raw
        .values
        .unwrap_or_default()
        .into_iter()
        // `type=scrum` is a query filter, but guard here too so a tolerant server
        // that echoes other board types can't slip a kanban board through.
        .find(|board| {
            board
                .board_type
                .as_deref()
                .map(|t| t.eq_ignore_ascii_case("scrum"))
                .unwrap_or(true)
        })
        .map(|board| board.id))
}

/// Parse `GET /board/{id}/sprint`. Drops sprints missing an id+name; orders active
/// before future (closed sprints are not requested), preserving server order within
/// a state.
fn parse_sprints(json: &str) -> Result<Vec<JiraSprint>, String> {
    let raw: RawSprints =
        serde_json::from_str(json).map_err(|error| format!("Failed to parse sprints: {error}"))?;
    let mut sprints: Vec<JiraSprint> = raw
        .values
        .unwrap_or_default()
        .into_iter()
        .filter_map(|sprint| {
            let name = sprint.name?;
            Some(JiraSprint {
                id: sprint.id,
                name,
                state: sprint.state.unwrap_or_else(|| "future".to_string()),
                start_date: sprint.start_date,
                end_date: sprint.end_date,
                goal: sprint.goal,
            })
        })
        .collect();
    sprints.sort_by_key(|sprint| sprint_state_rank(&sprint.state));
    Ok(sprints)
}

/// Sort key so active sprints render above future ones (a stable sort keeps the
/// server's order within each state).
fn sprint_state_rank(state: &str) -> u8 {
    match state.to_ascii_lowercase().as_str() {
        "active" => 0,
        "future" => 1,
        _ => 2,
    }
}

/// The issue fields the sprint board needs (enough to render a card and group by
/// epic). `epic` covers classic Agile boards; `parent` covers next-gen.
const SPRINT_ISSUE_FIELDS: &str = "summary,status,issuetype,priority,assignee,epic,parent";

pub fn find_scrum_board(
    site: &str,
    email: &str,
    token: &str,
    project: &str,
) -> Result<Option<i64>, String> {
    let body = get_agile(
        site,
        email,
        token,
        &format!("/board?projectKeyOrId={project}&type=scrum&maxResults=50"),
    )?;
    parse_first_board_id(&body)
}

fn list_sprints(
    site: &str,
    email: &str,
    token: &str,
    board_id: i64,
) -> Result<Vec<JiraSprint>, String> {
    let body = get_agile(
        site,
        email,
        token,
        &format!("/board/{board_id}/sprint?state=active,future&maxResults=50"),
    )?;
    parse_sprints(&body)
}

fn sprint_issues(
    site: &str,
    email: &str,
    token: &str,
    board_id: i64,
    sprint_id: i64,
) -> Result<Vec<JiraWorkItem>, String> {
    let body = get_agile(
        site,
        email,
        token,
        &format!(
            "/board/{board_id}/sprint/{sprint_id}/issue?fields={SPRINT_ISSUE_FIELDS}&maxResults=100"
        ),
    )?;
    // The Agile issue payload is shaped like the core search (`{ issues: [...] }`),
    // so the shared tolerant parser handles it — including epic/parent extraction.
    crate::jira::parse_work_items(&body)
}

fn backlog_issues(
    site: &str,
    email: &str,
    token: &str,
    board_id: i64,
) -> Result<Vec<JiraWorkItem>, String> {
    let body = get_agile(
        site,
        email,
        token,
        &format!("/board/{board_id}/backlog?fields={SPRINT_ISSUE_FIELDS}&maxResults=100"),
    )?;
    crate::jira::parse_work_items(&body)
}

/// Assemble the sprint board for a project: each active/future sprint with its
/// issues, then the backlog as a final `sprint: None` lane. Errors when the project
/// has no scrum board (the only board type that has sprints). Each issue carries its
/// `epic_key`/`epic_name` so the UI can group lanes into epic swimlanes.
pub fn sprint_board(
    site: &str,
    email: &str,
    token: &str,
    project: &str,
) -> Result<Vec<JiraSprintLane>, String> {
    let board_id = find_scrum_board(site, email, token, project)?.ok_or_else(|| {
        format!("No Scrum board found for project {project}. Sprint view needs a Scrum board.")
    })?;
    let sprints = list_sprints(site, email, token, board_id)?;
    let mut lanes = Vec::with_capacity(sprints.len() + 1);
    for sprint in sprints {
        let items = sprint_issues(site, email, token, board_id, sprint.id)?;
        lanes.push(JiraSprintLane {
            sprint: Some(sprint),
            items,
        });
    }
    let backlog = backlog_issues(site, email, token, board_id)?;
    lanes.push(JiraSprintLane {
        sprint: None,
        items: backlog,
    });
    Ok(lanes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_first_scrum_board_id() {
        let json = r#"{"values":[
            {"id":12,"name":"ENG kanban","type":"kanban"},
            {"id":34,"name":"ENG scrum","type":"scrum"}
        ]}"#;
        assert_eq!(parse_first_board_id(json).unwrap(), Some(34));
        // No boards at all -> None (surfaced as a friendly error upstream).
        assert_eq!(parse_first_board_id(r#"{"values":[]}"#).unwrap(), None);
        assert_eq!(parse_first_board_id(r#"{}"#).unwrap(), None);
    }

    #[test]
    fn parses_sprints_and_orders_active_first() {
        let json = r#"{"values":[
            {"id":2,"name":"Sprint 2","state":"future","startDate":"2026-07-01T00:00:00.000Z"},
            {"id":1,"name":"Sprint 1","state":"active","goal":"Ship login"},
            {"id":3,"name":"No name skipped state","state":"future"},
            {"id":4,"state":"active"}
        ]}"#;
        let sprints = parse_sprints(json).unwrap();
        // The id=4 entry has no name and is dropped; active sorts before future.
        assert_eq!(sprints.len(), 3);
        assert_eq!(sprints[0].id, 1);
        assert_eq!(sprints[0].state, "active");
        assert_eq!(sprints[0].goal.as_deref(), Some("Ship login"));
        assert_eq!(sprints[1].state, "future");
    }

    #[test]
    fn parses_transitions_fixture() {
        let json = include_str!("jira_fixtures/transitions.json");
        let items = parse_transitions(json).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[1].id, "21");
        assert_eq!(items[1].to_status_name, "In Progress");
        assert_eq!(items[1].to_status_category, JiraStatusCategory::InProgress);
        assert_eq!(items[2].to_status_name, "Done");
        assert_eq!(items[2].to_status_category, JiraStatusCategory::Done);
    }

    #[test]
    fn parses_project_statuses_union_dedup() {
        let json = include_str!("jira_fixtures/project_statuses.json");
        let items = parse_project_statuses(json).unwrap();
        // To Do/In Progress/Done from Task, plus Triage from Bug; "To Do" (id 10)
        // is shared and de-duplicated.
        let names: Vec<_> = items.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["To Do", "In Progress", "Done", "Triage"]);
        // "Triage" has no statusCategory; falls back to name-based -> Unknown.
        assert_eq!(items[3].category, JiraStatusCategory::Unknown);
        assert_eq!(items[0].category, JiraStatusCategory::ToDo);
    }

    #[test]
    fn finds_transition_id_for_status_case_insensitively() {
        let transitions =
            parse_transitions(include_str!("jira_fixtures/transitions.json")).unwrap();

        assert_eq!(
            transition_id_for_status(&transitions, "in progress"),
            Some("21")
        );
        assert_eq!(transition_id_for_status(&transitions, "Done"), Some("31"));
        assert_eq!(transition_id_for_status(&transitions, "Nonexistent"), None);
    }

    #[test]
    fn builds_basic_auth_header() {
        // base64("a@b.com:tok") = "YUBiLmNvbTp0b2s="
        assert_eq!(auth_header("a@b.com", "tok"), "Basic YUBiLmNvbTp0b2s=");
    }

    #[test]
    fn base_url_normalizes_scheme_and_trailing_slash() {
        let want = "https://team.atlassian.net/rest/api/3";
        assert_eq!(base("team.atlassian.net"), want);
        assert_eq!(base("https://team.atlassian.net"), want);
        assert_eq!(base("http://team.atlassian.net/"), want);
        assert_eq!(base("  team.atlassian.net/  "), want);
    }

    #[test]
    fn encodes_query_values() {
        assert_eq!(encode_query("ada@example.com"), "ada%40example.com");
        assert_eq!(encode_query("Ada Lovelace"), "Ada%20Lovelace");
        assert_eq!(encode_query("plain-value_1.2~"), "plain-value_1.2~");
    }

    #[test]
    fn parses_next_page_token() {
        assert_eq!(
            parse_next_page_token(r#"{"issues":[],"nextPageToken":"abc"}"#),
            Some("abc".to_string())
        );
        assert_eq!(parse_next_page_token(r#"{"issues":[]}"#), None);
        assert_eq!(parse_next_page_token("not json"), None);
    }

    #[test]
    fn search_page_payload_parses_with_shared_parser() {
        // A `/search/jql` page wraps its items under `issues`, one of the wrapped
        // shapes the shared tolerant parser accepts.
        let json = r#"{"issues":[{"key":"ENG-1","fields":{"summary":"Story","status":{"name":"To Do","statusCategory":{"key":"new"}}}}],"nextPageToken":"t1"}"#;
        let items = crate::jira::parse_work_items(json).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].key, "ENG-1");
        assert_eq!(items[0].status_category, JiraStatusCategory::ToDo);
    }

    #[test]
    fn project_search_payload_parses_with_shared_parser() {
        // `GET /project/search` wraps the page under `values`.
        let json = r#"{"values":[{"key":"ENG","name":"Engineering"}],"total":1}"#;
        let projects = crate::jira::parse_projects(json).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].key, "ENG");
    }

    fn user(id: &str, email: Option<&str>, name: Option<&str>, kind: &str) -> RawUser {
        RawUser {
            account_id: Some(id.to_string()),
            email_address: email.map(str::to_string),
            display_name: name.map(str::to_string),
            account_type: Some(kind.to_string()),
        }
    }

    #[test]
    fn picks_account_by_exact_email_then_name_then_single() {
        let users = vec![
            user("app-1", Some("ada@example.com"), Some("Ada Bot"), "app"),
            user("u-1", Some("ada@example.com"), Some("Ada"), "atlassian"),
            user("u-2", Some("other@example.com"), Some("Other"), "atlassian"),
        ];
        // Exact email wins; the app account with the same email is ignored.
        assert_eq!(pick_account_id(&users, "ADA@example.com").unwrap(), "u-1");
        // Exact display-name match.
        assert_eq!(pick_account_id(&users, "other").unwrap(), "u-2");
        // No exact match and multiple candidates -> ambiguous error.
        let error = pick_account_id(&users, "ad").unwrap_err();
        assert!(error.contains("multiple"), "unexpected error: {error}");
        // A single (non-app) result is unambiguous even without an exact match.
        let single = vec![user("u-9", None, Some("Solo"), "atlassian")];
        assert_eq!(pick_account_id(&single, "sol").unwrap(), "u-9");
        // No people at all.
        assert!(pick_account_id(&[], "ghost").is_err());
    }

    #[test]
    fn builds_minimal_adf_from_text() {
        let adf = text_to_adf("First line\n\nSecond line");
        assert_eq!(adf["type"], "doc");
        assert_eq!(adf["version"], 1);
        let content = adf["content"].as_array().unwrap();
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["content"][0]["text"], "First line");
        // The blank line becomes an empty paragraph (ADF forbids empty text nodes).
        assert_eq!(content[1]["content"].as_array().unwrap().len(), 0);
        assert_eq!(content[2]["content"][0]["text"], "Second line");
        // Round-trip through the read-side flattener preserves the text.
        let mut flat = String::new();
        crate::jira::collect_adf_text(&adf, &mut flat);
        assert_eq!(flat.trim(), "First line\n\nSecond line");
    }
}
