//! JIRA Cloud REST client for the optional API-token layer. The HTTP wrappers are
//! thin; the JSON shape handling lives in pure parse functions that are unit-tested
//! against golden fixtures (mirroring `native/src/jira.rs`).

use crate::models::{JiraStatusCategory, JiraStatusDef, JiraTransition};
use base64::Engine;
use serde::Deserialize;

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

fn get(site: &str, email: &str, token: &str, path: &str) -> Result<String, String> {
    let url = format!("{}{path}", base(site));
    match ureq::get(&url)
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
    let url = format!("{}/issue/{key}/transitions", base(site));
    match ureq::post(&url)
        .set("Authorization", &auth_header(email, token))
        .set("Accept", "application/json")
        .send_json(ureq::json!({ "transition": { "id": transition_id } }))
    {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!("JIRA transition failed ({code}): {}", body.trim()))
        }
        Err(error) => Err(format!("JIRA transition error: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
