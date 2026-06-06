# JIRA REST Custom Statuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, Keychain-token-gated JIRA Cloud REST layer so the app supports custom per-project workflows — a legal-transition status dropdown, a board status filter, and rendering of all custom status columns (including empty ones) — while `acli` remains the base integration.

**Architecture:** A new `native/src/jira_rest.rs` module talks to JIRA Cloud REST (`ureq`, Basic auth) for the three endpoints `acli` can't serve; the token lives in the macOS Keychain (`keyring`); site/email are detected from `acli` and stored as non-secret settings. REST is additive — every feature falls back to today's `acli`/item-derived behavior when no token is connected.

**Tech Stack:** Rust + Tauri, `ureq` (blocking HTTP + rustls), `base64`, `keyring` v3 (macOS Keychain), `rusqlite`; React + TypeScript frontend.

**Spec:** `docs/superpowers/specs/2026-06-06-jira-rest-custom-statuses-design.md`

---

## File structure

**Backend (create):**
- `native/src/jira_rest.rs` — REST client + pure parse functions (`parse_transitions`, `parse_project_statuses`).
- `native/src/jira_secret.rs` — Keychain token store/read/delete (`keyring`).
- `native/src/jira_fixtures/transitions.json`, `native/src/jira_fixtures/project_statuses.json` — golden fixtures.

**Backend (modify):**
- `native/Cargo.toml` — add `ureq`, `base64`, `keyring`.
- `native/src/lib.rs` — declare modules, add commands, register them, make `jira_transition_work_item` REST-aware.
- `native/src/models/jira.rs` — `JiraTransition`, `JiraStatusDef`, `JiraRestStatus`, `JiraStatusCategory::from_token`.
- `native/src/jira.rs` — `build_board_jql` gains a status clause; `map_category` delegates to `from_token`.
- `native/src/models/settings.rs` — `AppSettings.jira_rest_email`, `AppSettings.jira_filter_statuses`, `AppSettingsInput.jira_filter_statuses`.
- `native/src/db/schema.rs` — two `add_column_if_missing` migrations.
- `native/src/db/rows.rs` — map the two new columns.
- `native/src/db/mod.rs` — extend SELECT/UPDATE; add `set_jira_rest_account`.
- `native/src/db/tests.rs` — persistence test for the new fields.

**Frontend (modify):**
- `src/types.ts` — `JiraTransition`, `JiraStatusDef`, `JiraRestStatus`; extend `AppSettings`/`AppSettingsInput`.
- `src/api.ts` — wrappers for the new commands.
- `src/hooks/useJira.ts` — REST status, project statuses, connected `deriveColumns`, token set/clear.
- `src/hooks/useApp.ts` — pass `statusFilter` to `useJira`; expose REST status + token actions; extend `setJiraBoardConfig`.
- `src/components/settings/profileDrafts.ts` — `jiraFilterStatuses` in `toSettingsInput`/`fallbackSettings`.
- `src/components/JiraWorkItemDialog.tsx` — REST transitions in the dropdown.
- `src/components/JiraBoardPage.tsx` — multi-select status filter.
- `src/components/settings/JiraConnectionCard.tsx` (create) + `src/components/SettingsPage.tsx` — token card + JIRA section.
- `src/App.tsx` — thread REST status/token props into `SettingsPage`, status filter into `JiraBoardPage`.

**Docs (modify):** `docs/jira-integration.md`, `docs/features.md`, `docs/tracking-and-debugging.md`, `README.md`, `CLAUDE.md`.

**Key decisions locked for implementers:**
- `jira_rest_email` is **output-only** in `AppSettings` and is written **only** by `set_jira_api_token` (via `set_jira_rest_account`). It is NOT in `AppSettingsInput` and NOT touched by `update_app_settings`, so the general "Save Settings" button can't wipe it.
- `jira_filter_statuses` IS part of board config: in `AppSettings` + `AppSettingsInput` + `update_app_settings`, persisted as a JSON-encoded `TEXT` column (default `'[]'`).
- The JQL status clause works with or without a token; REST only enriches the filter's options and enables empty columns + the dropdown.
- Keychain service = the app identifier `com.hvp17.nectus` (from `native/tauri.conf.json`); account = `jira-api-token:{site}`.

---

## Task 1: Models — transition, status def, REST status, category helper

**Files:**
- Modify: `native/src/models/jira.rs`
- Test: `native/src/models/jira.rs` (inline `#[cfg(test)]`)

- [ ] **Step 1: Write the failing test** — append to `native/src/models/jira.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_from_token_classifies() {
        assert_eq!(JiraStatusCategory::from_token("done"), JiraStatusCategory::Done);
        assert_eq!(JiraStatusCategory::from_token("In Progress"), JiraStatusCategory::InProgress);
        assert_eq!(JiraStatusCategory::from_token("indeterminate"), JiraStatusCategory::InProgress);
        assert_eq!(JiraStatusCategory::from_token("To Do"), JiraStatusCategory::ToDo);
        assert_eq!(JiraStatusCategory::from_token("new"), JiraStatusCategory::ToDo);
        assert_eq!(JiraStatusCategory::from_token("Backlog"), JiraStatusCategory::Unknown);
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd native && cargo test --lib models::jira::tests::category_from_token_classifies`
Expected: FAIL — `from_token` not found.

- [ ] **Step 3: Add types + helper** — append to `native/src/models/jira.rs` (before the test module):

```rust
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd native && cargo test --lib models::jira::tests::category_from_token_classifies`
Expected: PASS.

- [ ] **Step 5: Point `jira::map_category` at the shared helper** — in `native/src/jira.rs`, replace the body of `map_category` (keeps existing tests green):

```rust
fn map_category(raw: Option<&RawStatusCategory>) -> JiraStatusCategory {
    let token = raw
        .and_then(|c| c.key.as_deref().or(c.name.as_deref()))
        .unwrap_or("");
    JiraStatusCategory::from_token(token)
}
```

- [ ] **Step 6: Run jira tests, verify still green**

Run: `cd native && cargo test --lib jira::tests`
Expected: PASS (all existing category tests).

- [ ] **Step 7: Commit**

```bash
git add native/src/models/jira.rs native/src/jira.rs
git commit -m "feat(jira): add REST model types and shared status-category helper"
```

---

## Task 2: Dependencies + Keychain secret store

**Files:**
- Modify: `native/Cargo.toml`
- Create: `native/src/jira_secret.rs`
- Modify: `native/src/lib.rs` (module declaration)

- [ ] **Step 1: Add crates** — in `native/Cargo.toml` `[dependencies]`, add:

```toml
ureq = { version = "2", features = ["json"] }
base64 = "0.22"
keyring = "3"
```

- [ ] **Step 2: Create the secret module** — `native/src/jira_secret.rs`:

```rust
//! macOS Keychain storage for the optional JIRA API token. The token never
//! touches SQLite; only the non-secret site/email live in app settings. Keyed
//! per-site so a future multi-site mode can coexist.

use keyring::Entry;

/// The app bundle identifier (see `native/tauri.conf.json`), used as the
/// Keychain service name.
const SERVICE: &str = "com.hvp17.nectus";

fn entry(site: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("jira-api-token:{site}"))
        .map_err(|error| format!("Failed to open Keychain entry: {error}"))
}

pub fn store_token(site: &str, token: &str) -> Result<(), String> {
    entry(site)?
        .set_password(token)
        .map_err(|error| format!("Failed to store JIRA token: {error}"))
}

/// Read the token for a site, or `None` if no entry exists.
pub fn read_token(site: &str) -> Result<Option<String>, String> {
    match entry(site)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read JIRA token: {error}")),
    }
}

pub fn delete_token(site: &str) -> Result<(), String> {
    match entry(site)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete JIRA token: {error}")),
    }
}
```

- [ ] **Step 3: Declare the module** — in `native/src/lib.rs`, add after `mod jira;`:

```rust
mod jira_rest;
mod jira_secret;
```

(Add `mod jira_rest;` now even though the file is created in Task 3; create an empty `native/src/jira_rest.rs` placeholder so this compiles — Task 3 fills it.)

- [ ] **Step 4: Create empty placeholder** — `native/src/jira_rest.rs` with a single line comment `//! JIRA Cloud REST client (filled in Task 3).` so the module resolves.

- [ ] **Step 5: Build to verify deps resolve**

Run: `cd native && cargo build`
Expected: compiles (downloads `ureq`/`base64`/`keyring`).

- [ ] **Step 6: Commit**

```bash
git add native/Cargo.toml native/Cargo.lock native/src/jira_secret.rs native/src/jira_rest.rs native/src/lib.rs
git commit -m "feat(jira): add ureq/base64/keyring deps and Keychain token store"
```

---

## Task 3: REST client + pure parsers + fixtures

**Files:**
- Modify: `native/src/jira_rest.rs`
- Create: `native/src/jira_fixtures/transitions.json`, `native/src/jira_fixtures/project_statuses.json`

- [ ] **Step 1: Add fixtures** —

`native/src/jira_fixtures/transitions.json`:

```json
{
  "expand": "transitions",
  "transitions": [
    { "id": "11", "name": "To Do", "to": { "name": "To Do", "statusCategory": { "key": "new", "name": "To Do" } } },
    { "id": "21", "name": "Start work", "to": { "name": "In Progress", "statusCategory": { "key": "indeterminate", "name": "In Progress" } } },
    { "id": "31", "name": "Done", "to": { "name": "Done", "statusCategory": { "key": "done", "name": "Done" } } }
  ]
}
```

`native/src/jira_fixtures/project_statuses.json`:

```json
[
  {
    "id": "10001", "name": "Task", "subtask": false,
    "statuses": [
      { "id": "10", "name": "To Do", "statusCategory": { "key": "new", "name": "To Do" } },
      { "id": "11", "name": "In Progress", "statusCategory": { "key": "indeterminate", "name": "In Progress" } },
      { "id": "12", "name": "Done", "statusCategory": { "key": "done", "name": "Done" } }
    ]
  },
  {
    "id": "10002", "name": "Bug", "subtask": false,
    "statuses": [
      { "id": "10", "name": "To Do", "statusCategory": { "key": "new", "name": "To Do" } },
      { "id": "13", "name": "Triage" }
    ]
  }
]
```

- [ ] **Step 2: Write the failing parser tests** — `native/src/jira_rest.rs`:

```rust
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
            Some(JiraTransition { id: t.id, name: t.name, to_status_name, to_status_category })
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
            let (Some(id), Some(name)) = (status.id, status.name) else { continue };
            if !seen.insert(id.clone()) {
                continue;
            }
            let category = category_of(&name, status.status_category.as_ref());
            out.push(JiraStatusDef { id, name, category });
        }
    }
    Ok(out)
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
}
```

- [ ] **Step 3: Run parser tests, verify they pass** (the placeholder file is replaced by this content)

Run: `cd native && cargo test --lib jira_rest::tests`
Expected: PASS — both tests.

- [ ] **Step 4: Add HTTP wrappers** — append to `native/src/jira_rest.rs`:

```rust
fn auth_header(email: &str, token: &str) -> String {
    let raw = format!("{email}:{token}");
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(raw))
}

fn base(site: &str) -> String {
    format!("https://{site}/rest/api/3")
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
mod auth_tests {
    use super::*;
    #[test]
    fn builds_basic_auth_header() {
        // base64("a@b.com:tok") = "YUBiLmNvbTp0b2s="
        assert_eq!(auth_header("a@b.com", "tok"), "Basic YUBiLmNvbTp0b2s=");
    }
}
```

- [ ] **Step 5: Run all jira_rest tests**

Run: `cd native && cargo test --lib jira_rest`
Expected: PASS — `tests` + `auth_tests`.

- [ ] **Step 6: Commit**

```bash
git add native/src/jira_rest.rs native/src/jira_fixtures/transitions.json native/src/jira_fixtures/project_statuses.json
git commit -m "feat(jira): REST client with fixture-tested transition/status parsers"
```

---

## Task 4: Settings fields + DB migration + persistence

**Files:**
- Modify: `native/src/models/settings.rs`, `native/src/db/schema.rs`, `native/src/db/rows.rs`, `native/src/db/mod.rs`
- Test: `native/src/db/tests.rs`

- [ ] **Step 1: Extend the models** — in `native/src/models/settings.rs`, add to `AppSettings` (after `jira_filter_current_sprint`):

```rust
    pub jira_rest_email: Option<String>,
    pub jira_filter_statuses: Vec<String>,
```

and to `AppSettingsInput` (after `jira_filter_current_sprint`):

```rust
    #[serde(default)]
    pub jira_filter_statuses: Vec<String>,
```

(`jira_rest_email` is intentionally **not** in `AppSettingsInput`.)

- [ ] **Step 2: Add migrations** — in `native/src/db/schema.rs` `run_migrations`, after the `jira_filter_current_sprint` block:

```rust
        self.add_column_if_missing("app_settings", "jira_rest_email", "TEXT")?;
        self.add_column_if_missing(
            "app_settings",
            "jira_filter_statuses",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
```

- [ ] **Step 3: Map the new columns** — in `native/src/db/rows.rs` `app_settings_from_row`, append after `jira_filter_current_sprint: row.get(11)?,`:

```rust
        jira_rest_email: row.get(12)?,
        jira_filter_statuses: serde_json::from_str::<Vec<String>>(
            &row.get::<_, String>(13)?,
        )
        .unwrap_or_default(),
```

- [ ] **Step 4: Extend SELECT/UPDATE + add account setter** — in `native/src/db/mod.rs`:

In `get_app_settings`, extend the SELECT column list (append after `jira_filter_current_sprint`): `, jira_rest_email, jira_filter_statuses`.

In `update_app_settings`, before the `execute`, add:

```rust
        let jira_filter_statuses = serde_json::to_string(&settings.jira_filter_statuses)
            .unwrap_or_else(|_| "[]".to_string());
```

Add to the UPDATE SET list: `, jira_filter_statuses = ?13` (do NOT touch `jira_rest_email` here), and append `jira_filter_statuses` to the `params![...]`.

Add a dedicated setter (used by `set_jira_api_token`):

```rust
    /// Persist the non-secret REST account (site + email). The token itself lives
    /// only in the Keychain; this never writes it.
    pub fn set_jira_rest_account(&self, site: &str, email: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE app_settings SET jira_site_url = ?1, jira_rest_email = ?2 WHERE id = 1",
                params![site, email],
            )
            .map_err(|error| format!("Failed to save JIRA REST account: {error}"))?;
        Ok(())
    }

    /// Clear the stored REST email (called on disconnect; the site is left as-is).
    pub fn clear_jira_rest_email(&self) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE app_settings SET jira_rest_email = NULL WHERE id = 1",
                [],
            )
            .map_err(|error| format!("Failed to clear JIRA REST email: {error}"))?;
        Ok(())
    }
```

- [ ] **Step 5: Fix the existing `AppSettingsInput` literals in tests** — `native/src/db/tests.rs` constructs `AppSettingsInput { ... }` at three sites (≈ lines 185, 255, 301). Add `jira_filter_statuses: vec![],` to each so they compile.

- [ ] **Step 6: Write the failing persistence test** — append to `native/src/db/tests.rs`:

```rust
#[test]
fn persists_jira_filter_statuses_and_rest_account() {
    let db = Database::open_in_memory().unwrap();
    let base = db.get_app_settings().unwrap();
    db.update_app_settings(AppSettingsInput {
        jira_filter_statuses: vec!["To Do".into(), "Done".into()],
        ..base_input(&base)
    })
    .unwrap();
    db.set_jira_rest_account("acme.atlassian.net", "a@b.com").unwrap();

    let reloaded = db.get_app_settings().unwrap();
    assert_eq!(reloaded.jira_filter_statuses, vec!["To Do", "Done"]);
    assert_eq!(reloaded.jira_rest_email.as_deref(), Some("a@b.com"));
    assert_eq!(reloaded.jira_site_url.as_deref(), Some("acme.atlassian.net"));
}
```

If a `base_input(&base)` helper does not already exist in `tests.rs`, build the `AppSettingsInput` explicitly instead (copy the pattern from the nearby `update_app_settings` test at ~line 255, adding `jira_filter_statuses: vec!["To Do".into(), "Done".into()]`). Confirm `Database::open_in_memory` is the helper used by neighboring tests; match their constructor.

- [ ] **Step 7: Run, verify pass**

Run: `cd native && cargo test --lib db::`
Expected: PASS (new test + existing settings tests).

- [ ] **Step 8: Commit**

```bash
git add native/src/models/settings.rs native/src/db/
git commit -m "feat(settings): persist jira_filter_statuses and rest email"
```

---

## Task 5: Tauri commands (REST status, transitions, project statuses, token)

**Files:**
- Modify: `native/src/lib.rs`

- [ ] **Step 1: Add command bodies** — in `native/src/lib.rs`, after `jira_create_work_item` (≈ line 415). First extend the models import (line 10-15) to include `JiraRestStatus, JiraStatusDef, JiraTransition`.

```rust
/// REST connection state: a token is "connected" when the Keychain holds one for
/// the configured site and an email is set.
#[tauri::command]
fn jira_rest_status(state: State<'_, AppState>) -> AppResult<JiraRestStatus> {
    let (site, email) = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        (settings.jira_site_url, settings.jira_rest_email)
    };
    let Some(site) = site.filter(|s| !s.trim().is_empty()) else {
        return Ok(JiraRestStatus { connected: false, site: None, email, error: None });
    };
    let has_token = jira_secret::read_token(&site)?.is_some();
    Ok(JiraRestStatus {
        connected: has_token && email.is_some(),
        site: Some(site),
        email,
        error: None,
    })
}

/// Verify a token via `GET /myself`, then store it in the Keychain and persist the
/// non-secret site/email. Stores nothing on failure.
#[tauri::command]
async fn set_jira_api_token(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> AppResult<JiraRestStatus> {
    let (site, email, token) = (site.trim().to_string(), email.trim().to_string(), token);
    if site.is_empty() || email.is_empty() || token.is_empty() {
        return Err(AppError::from("Site, email, and token are all required"));
    }
    let verify = {
        let (s, e, t) = (site.clone(), email.clone(), token.clone());
        tauri::async_runtime::spawn_blocking(move || jira_rest::verify(&s, &e, &t))
            .await
            .map_err(|error| AppError::from(format!("Failed to verify JIRA token: {error}")))?
    };
    verify.map_err(AppError::from)?;
    jira_secret::store_token(&site, &token).map_err(AppError::from)?;
    {
        let db = state.db.lock();
        db.set_jira_rest_account(&site, &email)?;
    }
    Ok(JiraRestStatus { connected: true, site: Some(site), email: Some(email), error: None })
}

#[tauri::command]
fn clear_jira_api_token(state: State<'_, AppState>) -> AppResult<()> {
    let site = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        db.clear_jira_rest_email()?;
        settings.jira_site_url
    };
    if let Some(site) = site.filter(|s| !s.trim().is_empty()) {
        jira_secret::delete_token(&site).map_err(AppError::from)?;
    }
    Ok(())
}

/// List an issue's legal transitions via REST. Errors if no token is connected.
#[tauri::command]
async fn jira_list_transitions(
    state: State<'_, AppState>,
    key: String,
) -> AppResult<Vec<JiraTransition>> {
    let (site, email, token) = rest_credentials(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        jira_rest::list_transitions(&site, &email, &token, &key)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to list transitions: {error}")))?
    .map_err(Into::into)
}

#[tauri::command]
async fn jira_project_statuses(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<JiraStatusDef>> {
    let (site, email, token) = rest_credentials(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        jira_rest::project_statuses(&site, &email, &token, &project)
    })
    .await
    .map_err(|error| AppError::from(format!("Failed to load project statuses: {error}")))?
    .map_err(Into::into)
}
```

- [ ] **Step 2: Add the credential helper** — in `native/src/lib.rs` near the jira commands:

```rust
/// Resolve `(site, email, token)` for a REST call, or an error when not connected.
fn rest_credentials(state: &State<'_, AppState>) -> Result<(String, String, String), AppError> {
    let (site, email) = {
        let db = state.db.lock();
        let settings = db.get_app_settings()?;
        (settings.jira_site_url, settings.jira_rest_email)
    };
    let site = site
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    let email = email
        .filter(|e| !e.trim().is_empty())
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    let token = jira_secret::read_token(&site)?
        .ok_or_else(|| AppError::from("Connect a JIRA API token in Settings first"))?;
    Ok((site, email, token))
}
```

- [ ] **Step 3: Make `jira_transition_work_item` REST-aware** — replace the existing body (≈ lines 366-372):

```rust
/// Transition a work item. When a REST token is connected, resolve the target
/// status name to a legal transition id and POST it; otherwise fall back to acli.
/// JIRA workflow rejections surface as errors and the UI reverts the card.
#[tauri::command]
async fn jira_transition_work_item(
    state: State<'_, AppState>,
    key: String,
    status: String,
) -> AppResult<()> {
    if let Ok((site, email, token)) = rest_credentials(&state) {
        let (k, s) = (key.clone(), status.clone());
        return tauri::async_runtime::spawn_blocking(move || {
            let transitions = jira_rest::list_transitions(&site, &email, &token, &k)?;
            let target = transitions
                .iter()
                .find(|t| t.to_status_name.eq_ignore_ascii_case(&s))
                .ok_or_else(|| format!("No legal transition to \"{s}\" from the current status"))?;
            jira_rest::perform_transition(&site, &email, &token, &k, &target.id)
        })
        .await
        .map_err(|error| AppError::from(format!("Failed to transition work item: {error}")))?
        .map_err(Into::into);
    }
    tauri::async_runtime::spawn_blocking(move || jira::transition(&key, &status))
        .await
        .map_err(|error| AppError::from(format!("Failed to transition work item: {error}")))?
        .map_err(Into::into)
}
```

- [ ] **Step 4: Register the new commands** — in the `tauri::generate_handler![...]` list (≈ line 778), after `jira_create_work_item,`:

```rust
            jira_rest_status,
            set_jira_api_token,
            clear_jira_api_token,
            jira_list_transitions,
            jira_project_statuses,
```

- [ ] **Step 5: Build + run backend tests**

Run: `cd native && cargo build && cargo test`
Expected: compiles; all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add native/src/lib.rs
git commit -m "feat(jira): REST-aware transition + token/transitions/statuses commands"
```

---

## Task 6: `build_board_jql` status clause

**Files:**
- Modify: `native/src/jira.rs`, `native/src/lib.rs` (pass statuses)
- Test: `native/src/jira.rs`

- [ ] **Step 1: Write the failing tests** — in `native/src/jira.rs` `tests`, add:

```rust
    #[test]
    fn builds_board_jql_with_status_filter() {
        assert_eq!(
            build_board_jql("ENG", false, false, false, &["To Do".into(), "In Progress".into()]),
            "project = \"ENG\" AND status in (\"To Do\", \"In Progress\") ORDER BY updated DESC"
        );
    }

    #[test]
    fn builds_board_jql_empty_status_filter_adds_no_clause() {
        assert_eq!(
            build_board_jql("ENG", false, false, false, &[]),
            "project = \"ENG\" ORDER BY updated DESC"
        );
    }
```

- [ ] **Step 2: Update the three existing `build_board_jql` tests** — append `, &[]` as the final argument to the calls in `builds_board_jql_from_project_only`, `builds_board_jql_with_all_filters`, and `builds_board_jql_escapes_quotes_in_project_key`.

- [ ] **Step 3: Run, verify failure**

Run: `cd native && cargo test --lib jira::tests::builds_board_jql`
Expected: FAIL — arity mismatch / new tests fail.

- [ ] **Step 4: Add the parameter + clause** — change `build_board_jql` signature and body:

```rust
pub fn build_board_jql(
    project: &str,
    my_issues: bool,
    unresolved: bool,
    current_sprint: bool,
    statuses: &[String],
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
    let statuses: Vec<String> = statuses
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("\"{}\"", s.replace('"', "\\\"")))
        .collect();
    if !statuses.is_empty() {
        clauses.push(format!("status in ({})", statuses.join(", ")));
    }
    format!("{} ORDER BY updated DESC", clauses.join(" AND "))
}
```

- [ ] **Step 5: Pass statuses from the command** — in `native/src/lib.rs` `jira_search_board`, capture `settings.jira_filter_statuses` and pass it:

```rust
        let statuses = settings.jira_filter_statuses.clone();
        jira::build_board_jql(
            &project,
            settings.jira_filter_my_issues,
            settings.jira_filter_unresolved,
            settings.jira_filter_current_sprint,
            &statuses,
        )
```

- [ ] **Step 6: Run jira + build**

Run: `cd native && cargo test --lib jira:: && cargo build`
Expected: PASS + compiles.

- [ ] **Step 7: Commit**

```bash
git add native/src/jira.rs native/src/lib.rs
git commit -m "feat(jira): add status filter clause to board JQL"
```

---

## Task 7: Frontend types + api wrappers

**Files:**
- Modify: `src/types.ts`, `src/api.ts`

- [ ] **Step 1: Add types** — in `src/types.ts`, near the JIRA types (after `JiraWorkItem`, ≈ line 110):

```ts
export interface JiraTransition {
  id: string;
  name: string;
  toStatusName: string;
  toStatusCategory: JiraStatusCategory;
}

export interface JiraStatusDef {
  id: string;
  name: string;
  category: JiraStatusCategory;
}

export interface JiraRestStatus {
  connected: boolean;
  site?: string | null;
  email?: string | null;
  error?: string | null;
}
```

In `AppSettings` add: `jiraRestEmail?: string | null;` and `jiraFilterStatuses: string[];`.
In `AppSettingsInput` add: `jiraFilterStatuses: string[];`.

- [ ] **Step 2: Add api wrappers** — in `src/api.ts`, after `jiraCommentWorkItem` (≈ line 196). Import the new types in the type import block (`JiraTransition`, `JiraStatusDef`, `JiraRestStatus`):

```ts
  async jiraRestStatus(): Promise<JiraRestStatus> {
    if (isBrowserPreview) return { connected: false, site: null, email: null, error: null };
    return invoke("jira_rest_status");
  },
  async setJiraApiToken(site: string, email: string, token: string): Promise<JiraRestStatus> {
    return invoke("set_jira_api_token", { site, email, token });
  },
  async clearJiraApiToken(): Promise<void> {
    return invoke("clear_jira_api_token");
  },
  async jiraListTransitions(key: string): Promise<JiraTransition[]> {
    if (isBrowserPreview) return [];
    return invoke("jira_list_transitions", { key });
  },
  async jiraProjectStatuses(project: string): Promise<JiraStatusDef[]> {
    if (isBrowserPreview) return [];
    return invoke("jira_project_statuses", { project });
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit` (run `pnpm install` first if needed)
Expected: no new errors from these files (the `profileDrafts.ts`/`useApp.ts` errors are fixed in later tasks; if `tsc` flags missing `jiraFilterStatuses`, proceed — Task 8/11 add them).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "feat(jira): frontend types and api wrappers for REST layer"
```

---

## Task 8: `useJira` — REST status, project statuses, connected columns

**Files:**
- Modify: `src/hooks/useJira.ts`, `src/components/settings/profileDrafts.ts`
- Test: `src/hooks/useJira.test.ts` (create if absent; otherwise add to the existing board test file)

- [ ] **Step 1: Seed the input defaults** — in `src/components/settings/profileDrafts.ts`, add `jiraFilterStatuses: []` to both `fallbackSettings` (as `jiraFilterStatuses: []` and `jiraRestEmail: null`) and the object returned by `toSettingsInput` (`jiraFilterStatuses: settings.jiraFilterStatuses ?? []`). Inspect the file first to match its exact shape.

- [ ] **Step 2: Write the failing `deriveColumns` test** — `src/hooks/useJira.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveColumns } from "./useJira";
import type { JiraStatusDef, JiraWorkItem } from "../types";

const item = (key: string, statusName: string): JiraWorkItem => ({
  key, summary: key, statusName, statusCategory: "to_do",
  issueType: null, priority: null, assignee: null, url: null, description: null,
});

describe("deriveColumns", () => {
  it("derives from items when no project statuses (current behavior)", () => {
    const cols = deriveColumns([item("A-1", "To Do")], [], []);
    expect(cols.map((c) => c.statusName)).toEqual(["To Do"]);
  });

  it("renders every project status as a column, including empty ones", () => {
    const defs: JiraStatusDef[] = [
      { id: "1", name: "To Do", category: "to_do" },
      { id: "2", name: "In Progress", category: "in_progress" },
      { id: "3", name: "Done", category: "done" },
    ];
    const cols = deriveColumns([item("A-1", "To Do")], defs, []);
    expect(cols.map((c) => c.statusName)).toEqual(["To Do", "In Progress", "Done"]);
    expect(cols[2].items).toEqual([]); // Done column empty but present
  });

  it("narrows the skeleton to the active status filter", () => {
    const defs: JiraStatusDef[] = [
      { id: "1", name: "To Do", category: "to_do" },
      { id: "3", name: "Done", category: "done" },
    ];
    const cols = deriveColumns([], defs, ["Done"]);
    expect(cols.map((c) => c.statusName)).toEqual(["Done"]);
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `pnpm test src/hooks/useJira.test.ts`
Expected: FAIL — `deriveColumns` arity is `(items)`.

- [ ] **Step 4: Update `deriveColumns`** — replace the signature/body in `src/hooks/useJira.ts`:

```ts
export function deriveColumns(
  items: JiraWorkItem[],
  projectStatuses: JiraStatusDef[] = [],
  statusFilter: string[] = [],
): JiraColumn[] {
  const itemsByStatus = new Map<string, JiraWorkItem[]>();
  for (const item of items) {
    const bucket = itemsByStatus.get(item.statusName);
    if (bucket) bucket.push(item);
    else itemsByStatus.set(item.statusName, [item]);
  }

  // Connected: the column skeleton is the project's full status set (narrowed to
  // the active filter), so empty statuses still render. Disconnected: derive from
  // the items present, narrowed to the filter if one is set (client-side).
  const filter = new Set(statusFilter);
  let columns: JiraColumn[];
  if (projectStatuses.length > 0) {
    const skeleton = projectStatuses.filter((s) => filter.size === 0 || filter.has(s.name));
    columns = skeleton.map((s) => ({
      statusName: s.name,
      category: s.category,
      items: itemsByStatus.get(s.name) ?? [],
    }));
    // Surface any item whose status isn't in the project skeleton (safety net).
    for (const [statusName, bucket] of itemsByStatus) {
      if (!skeleton.some((s) => s.name === statusName) && (filter.size === 0 || filter.has(statusName))) {
        columns.push({ statusName, category: bucket[0].statusCategory, items: bucket });
      }
    }
  } else {
    columns = [...itemsByStatus.entries()]
      .filter(([statusName]) => filter.size === 0 || filter.has(statusName))
      .map(([statusName, bucket]) => ({
        statusName,
        category: bucket[0].statusCategory,
        items: bucket,
      }));
  }

  return columns.sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return byCategory !== 0 ? byCategory : a.statusName.localeCompare(b.statusName);
  });
}
```

Add `JiraStatusDef` to the type import at the top of the file.

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test src/hooks/useJira.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire REST state into the hook** — in `useJira`:
  - Add input field `statusFilter: string[]` to `UseJiraInput` and destructure it.
  - Add state: `const [restStatus, setRestStatus] = useState<JiraRestStatus>();` and `const [projectStatuses, setProjectStatuses] = useState<JiraStatusDef[]>([]);`.
  - In the existing `ready`-gated `useAsyncEffect`, also load `api.jiraRestStatus()` → `setRestStatus`.
  - Add a `useAsyncEffect` keyed on `[active, ready, configured, restStatus?.connected, project]` that, when `restStatus?.connected` and a project is configured, calls `api.jiraProjectStatuses(project)` → `setProjectStatuses` (else `setProjectStatuses([])`). The board project comes from settings; pass `project: string | null` into `UseJiraInput` (add it; `useApp` supplies `settings?.jiraBoardProject`).
  - Add `setApiToken`/`clearApiToken` callbacks wrapping `api.setJiraApiToken`/`api.clearJiraApiToken`, refreshing `restStatus` after.
  - Change the return: `columns: deriveColumns(items, projectStatuses, statusFilter)` and expose `restStatus`, `projectStatuses`, `setApiToken`, `clearApiToken`.

- [ ] **Step 7: Run the full frontend suite + typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: PASS (with Task 9-11 still pending wiring, `tsc` may flag `useApp`/components — fix those in their tasks; this task's own files are clean).

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useJira.ts src/components/settings/profileDrafts.ts src/hooks/useJira.test.ts
git commit -m "feat(jira): useJira REST status, project statuses, connected columns"
```

---

## Task 9: REST transitions in the work-item dropdown

**Files:**
- Modify: `src/components/JiraWorkItemDialog.tsx`
- Test: extend the existing JIRA panel test (search for `JiraWorkItemPanel` under `src/`); otherwise create `src/components/JiraWorkItemDialog.test.tsx`.

- [ ] **Step 1: Add a `transitions` prop + fetch-on-open** — `JiraWorkItemPanelProps` gains `restConnected: boolean` and `onListTransitions: (key: string) => Promise<JiraTransition[]>`. Inside the component:

```tsx
  const [restOptions, setRestOptions] = useState<string[] | null>(null);
  useEffect(() => {
    if (!restConnected) {
      setRestOptions(null);
      return;
    }
    let alive = true;
    setRestOptions(null);
    onListTransitions(item.key)
      .then((transitions) => {
        if (alive) setRestOptions(transitions.map((t) => t.toStatusName));
      })
      .catch(() => {
        if (alive) setRestOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [restConnected, item.key, onListTransitions]);

  // When connected, offer the issue's legal transitions (plus its current status so
  // the Select shows a value); otherwise fall back to the board-derived options.
  const options = restConnected
    ? Array.from(new Set([item.statusName, ...(restOptions ?? [])]))
    : statusOptions.includes(item.statusName)
      ? statusOptions
      : [item.statusName, ...statusOptions];
```

Import `useEffect` and `JiraTransition`. Keep the existing `<Select>` markup; it now maps over `options`.

- [ ] **Step 2: Thread the prop through `JiraBoardPage`** — in `src/components/JiraBoardPage.tsx`, add `restConnected: boolean` and `onListTransitions` to `JiraBoardPageProps`, destructure them, and pass to `<JiraWorkItemPanel ... restConnected={restConnected} onListTransitions={onListTransitions} />`.

- [ ] **Step 3: Write a test** — render `JiraWorkItemPanel` with `restConnected` and a stub `onListTransitions` resolving `[{id:"21",name:"Start",toStatusName:"In Progress",toStatusCategory:"in_progress"}]`; open the Select; assert "In Progress" appears as an option. Use `src/test/testUtils.tsx` helpers and the existing panel-test patterns.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test src/components/JiraWorkItemDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/JiraWorkItemDialog.tsx src/components/JiraBoardPage.tsx src/components/JiraWorkItemDialog.test.tsx
git commit -m "feat(jira): show legal REST transitions in the status dropdown"
```

---

## Task 10: Board status filter

**Files:**
- Modify: `src/components/JiraBoardPage.tsx`, `src/hooks/useApp.ts`, `src/App.tsx`
- Test: extend the board test.

- [ ] **Step 1: Extend the config/filters shapes** — in `src/components/JiraBoardPage.tsx`: `JiraBoardFilters` gains `statuses: string[]`; `JiraBoardConfigChange` gains `statuses?: string[]`. Add props `statusOptionsAll: string[]` (the full options for the filter — project statuses when connected, else the board-derived `statusOptions`) — compute it from props rather than adding a new prop if `projectStatuses` is threaded; simplest is a new prop `filterableStatuses: string[]`.

- [ ] **Step 2: Render the multi-select** — add, inside the `.nx-seg` toolbar block, a `DropdownMenu` (shadcn) with checkbox items, or a compact popover of toggle chips, bound to `filters.statuses`. On toggle, call `onChangeConfig({ statuses: nextSelection })`. Use the installed `DropdownMenu` primitive (`src/components/ui/dropdown-menu`) with `DropdownMenuCheckboxItem`; label the trigger "Status" with a count badge when `filters.statuses.length > 0`. Disable when `!project`.

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button type="button" variant="outline" size="sm" disabled={!project} className="gap-2">
      Status{filters.statuses.length > 0 ? ` (${filters.statuses.length})` : ""}
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
    {filterableStatuses.length === 0 ? (
      <DropdownMenuItem disabled>No statuses</DropdownMenuItem>
    ) : (
      filterableStatuses.map((name) => (
        <DropdownMenuCheckboxItem
          key={name}
          checked={filters.statuses.includes(name)}
          onCheckedChange={(checked) =>
            onChangeConfig({
              statuses: checked
                ? [...filters.statuses, name]
                : filters.statuses.filter((s) => s !== name),
            })
          }
        >
          {name}
        </DropdownMenuCheckboxItem>
      ))
    )}
  </DropdownMenuContent>
</DropdownMenu>
```

Verify `DropdownMenuCheckboxItem` is exported from `src/components/ui/dropdown-menu`; if not, add it via `pnpm dlx shadcn@latest add dropdown-menu` (inspect impact before `--overwrite`).

- [ ] **Step 3: Persist the selection** — in `src/hooks/useApp.ts` `setJiraBoardConfig`, extend the `partial` type with `statuses?: string[]` and the `updateAppSettings` payload with `jiraFilterStatuses: partial.statuses ?? settings.jiraFilterStatuses`.

- [ ] **Step 4: Wire props in `App.tsx`** — pass to `<JiraBoardPage>`: `filters.statuses` from `settings?.jiraFilterStatuses ?? []`, `filterableStatuses` (from `jiraProjectStatuses` names when connected else board-derived — expose `jiraProjectStatuses` and `jiraRestStatus` from `useApp`), `restConnected={Boolean(jiraRestStatus?.connected)}`, and `onListTransitions={api.jiraListTransitions}`. Also pass `statusFilter` into `useJira` (`statusFilter: settings?.jiraFilterStatuses ?? []`, `project: settings?.jiraBoardProject ?? null`).

- [ ] **Step 5: Write a test** — render `JiraBoardPage` with `filterableStatuses={["To Do","Done"]}`, open the Status menu, toggle "Done", assert `onChangeConfig` called with `{ statuses: ["Done"] }`.

- [ ] **Step 6: Run frontend tests + typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/JiraBoardPage.tsx src/hooks/useApp.ts src/App.tsx
git commit -m "feat(jira): board status filter persisted to board config"
```

---

## Task 11: Settings JIRA token card

**Files:**
- Create: `src/components/settings/JiraConnectionCard.tsx`
- Modify: `src/components/SettingsPage.tsx`, `src/hooks/useApp.ts`, `src/App.tsx`

- [ ] **Step 1: Create the card** — `src/components/settings/JiraConnectionCard.tsx`. A self-contained card: prefilled site/email (editable), token password input, Test & Save / Disconnect, status badge. Props: `status?: JiraRestStatus`, `detectedSite?: string | null`, `onSave(site,email,token): Promise<JiraRestStatus>`, `onDisconnect(): Promise<void>`, `busy: boolean`. Build from `Field`, `Input`, `Button`, `Badge` (mirror `GithubConnectionCard` + the `nx-strip` shell). Show `status.error` via `FieldError`/`Alert` when present.

- [ ] **Step 2: Add a JIRA settings section** — in `src/components/SettingsPage.tsx`: add `"jira"` to `SettingsSectionId`, a nav item (icon: a JIRA/`Kanban` lucide icon), a `<section id="settings-section-jira">` rendering `<JiraConnectionCard .../>`, and the new props on `SettingsPageProps` (`jiraRestStatus`, `jiraDetectedSite`, `onSaveJiraToken`, `onDisconnectJira`). Place between GitHub and Appearance.

- [ ] **Step 3: Expose actions from `useApp`** — return `jiraRestStatus` (from `useJira`), `jiraProjectStatuses`, and `saveJiraToken`/`disconnectJira` (wrapping `jira.setApiToken`/`jira.clearApiToken` through `run`). `jiraDetectedSite` = `jiraStatus?.site` (acli-detected).

- [ ] **Step 4: Wire into `App.tsx`** — pass the new props to `<SettingsPage>`.

- [ ] **Step 5: Test** — render `JiraConnectionCard` disconnected, fill site/email/token, click Test & Save, assert `onSave` called with the entered values; render connected, click Disconnect, assert `onDisconnect` called.

- [ ] **Step 6: Run frontend tests + typecheck + build**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: PASS + clean build.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/JiraConnectionCard.tsx src/components/SettingsPage.tsx src/hooks/useApp.ts src/App.tsx
git commit -m "feat(settings): JIRA API token connection card"
```

---

## Task 12: Docs + full verification

**Files:**
- Modify: `docs/jira-integration.md`, `docs/features.md`, `docs/tracking-and-debugging.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update docs** — concrete, repo-grounded edits:
  - `docs/jira-integration.md`: new "Optional REST layer" section — token setup, Keychain (`com.hvp17.nectus` / `jira-api-token:{site}`), the three endpoints (`/myself`, `/issue/{key}/transitions`, `/project/{key}/statuses`, `POST /issue/{key}/transitions`), the acli-vs-REST split, and the new commands.
  - `docs/features.md`: legal-transition dropdown, board status filter, empty custom-status columns, token-optional connection model.
  - `docs/tracking-and-debugging.md`: `app_settings.jira_rest_email` / `jira_filter_statuses` columns, Keychain entry, new Tauri commands, REST failure modes.
  - `README.md` + `CLAUDE.md`: note the additive, token-optional REST layer and the deliberate Keychain-scoped exception to "no app-managed tokens."

- [ ] **Step 2: Full verification gate**

Run:
```bash
pnpm test
pnpm build
cd native && cargo test
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs(jira): document optional REST custom-status layer"
```

---

## Self-review notes

- **Spec coverage:** §3 endpoints → Tasks 3/5; §5 auth/site-email detection → Tasks 4/5 (+ acli `jira_status.site`); §6 types → Task 1; §7 commands → Tasks 5/6; §8 settings/migration → Task 4; §9 frontend (dropdown/filter/columns/settings) → Tasks 7-11; §10 error handling → Tasks 3/5 (`ureq::Error::Status` mapping, optimistic revert unchanged); §11 testing → Tasks 1,3,4,6,8,9,10,11; §12 docs → Task 12.
- **Type consistency:** `JiraTransition.toStatusName`/`toStatusCategory`, `JiraStatusDef.{id,name,category}`, `JiraRestStatus.{connected,site,email,error}` are identical across Rust (camelCase serde) and `src/types.ts`. `deriveColumns(items, projectStatuses, statusFilter)` arity matches every call site (Task 8 hook return + tests). `build_board_jql(.., &[String])` arity updated at the one call site (Task 6) and all four tests.
- **Open edge (accepted, per spec non-goals):** status-name→transition-id resolution is by `to_status_name` (case-insensitive); a workflow with two transitions to the same target name resolves to the first. Documented behavior.
