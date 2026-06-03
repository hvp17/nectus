# JIRA Board View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class JIRA board view backed by the official Atlassian CLI (`acli`), with full work-item management and the ability to attach Codex/Claude tasks to JIRA stories.

**Architecture:** Mirror the existing `gh` integration end-to-end. A new Rust module `native/src/jira.rs` shells out to `acli` (which owns its own auth — no tokens stored), parsing `--json` output in pure, unit-tested functions. New `jira_*` Tauri commands expose status/search/view/transition/edit/assign/comment/create. The frontend gains a `"jira"` view (`JiraBoardPage`), a `useJira` hook mirroring `useGithub`, columns auto-derived from result statuses, optimistic drag-to-transition, and a task↔story link stored locally on the task (no JIRA write-back on attach).

**Tech Stack:** Rust + Tauri 2 + rusqlite, React + TypeScript + Vite, shadcn/ui, Vitest, `cargo test`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-jira-board-view-design.md`

---

## File Structure

**Backend (create):**
- `native/src/jira.rs` — `acli` shell-out layer: `JiraWorkItem`/`JiraStatus` parsing + command runners. Pure parsers are unit-tested.

**Backend (modify):**
- `native/src/models.rs` — add `jira_issue_key/summary/url` to `TaskSummary`; add `jira_board_jql/jira_site_url` to `AppSettings` + `AppSettingsInput`; add `JiraStatus`, `JiraWorkItem`, `JiraStatusCategory`.
- `native/src/db/schema.rs` — add idempotent `run_migrations()` that `ALTER TABLE`s the new columns; call it from `create_schema`.
- `native/src/db/mod.rs` — extend `get_app_settings`/`update_app_settings` SELECT/UPDATE; add `set_task_jira_link`; extend task SELECTs with the 3 new columns.
- `native/src/db/rows.rs` — read the new columns in `task_from_row` and `app_settings_from_row`.
- `native/src/lib.rs` — `mod jira;` + register and implement `jira_*` commands; extend `create_task` with optional jira link params.

**Frontend (create):**
- `src/hooks/useJira.ts` — board state + actions (mirror `useGithub.ts`).
- `src/components/JiraBoardPage.tsx` — the view: header, columns, cards.
- `src/components/JiraWorkItemDialog.tsx` — detail/management dialog (transition/edit/assign/comment + Create task).
- `src/components/JiraPanel.tsx` — compact linked-issue panel for `TaskWorkspace`.

**Frontend (modify):**
- `src/types.ts` — mirror new Rust types + task/settings fields.
- `src/api.ts` — `jira*` wrappers; extend `createTask`; add `setTaskJiraLink`.
- `src/hooks/useApp.ts` — `currentView` adds `"jira"`; wire `useJira`; pending-link + create-from-story; repo id in create form.
- `src/hooks/useCreateTaskForm.ts` — add `newTaskRepoId` + pending jira link state.
- `src/components/CreateTaskModal.tsx` — add a repo `Select`; accept `repos`.
- `src/components/Sidebar.tsx` — add a "JIRA" footer button (`onOpenJira`, `jiraActive`).
- `src/App.tsx` — render `JiraBoardPage` for `currentView === "jira"`; pass repos to modal; render `JiraPanel` in task workspace.
- `src/components/TaskRow.tsx` / `src/components/TaskCard.tsx` — JIRA key `Badge` when linked.

**Docs (create/modify):** `docs/jira-integration.md` (new); update `CLAUDE.md`, `docs/features.md`, `README.md`.

---

## Phase A — Backend data model, schema migration, settings

### Task A1: Add an idempotent column migration

**Files:**
- Modify: `native/src/db/schema.rs`

- [ ] **Step 1: Add `add_column_if_missing` + `run_migrations`, call from `create_schema`.**

In `native/src/db/schema.rs`, inside `impl Database`, after `create_schema` returns `Ok`, call migrations. Replace the final `.map_err(...)` chain of `create_schema` so it ends by calling `self.run_migrations()`:

```rust
    pub(super) fn create_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                /* ...existing CREATE TABLE statements unchanged... */
                ",
            )
            .map_err(|error| format!("Failed to create database schema: {error}"))?;
        self.run_migrations()
    }

    /// Additive, idempotent column migrations for existing databases. The base
    /// schema uses `CREATE TABLE IF NOT EXISTS`, so new columns on existing
    /// tables must be added here. Safe to run on every open.
    pub(super) fn run_migrations(&self) -> Result<(), String> {
        self.add_column_if_missing("tasks", "jira_issue_key", "TEXT")?;
        self.add_column_if_missing("tasks", "jira_issue_summary", "TEXT")?;
        self.add_column_if_missing("tasks", "jira_issue_url", "TEXT")?;
        self.add_column_if_missing("app_settings", "jira_board_jql", "TEXT")?;
        self.add_column_if_missing("app_settings", "jira_site_url", "TEXT")?;
        Ok(())
    }

    fn add_column_if_missing(&self, table: &str, column: &str, decl: &str) -> Result<(), String> {
        let exists: bool = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .map(|rows| rows.filter_map(Result::ok).any(|name| name == column))
            })
            .map_err(|error| format!("Failed to inspect {table}: {error}"))?;
        if !exists {
            self.conn
                .execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
                .map_err(|error| format!("Failed to add {table}.{column}: {error}"))?;
        }
        Ok(())
    }
```

- [ ] **Step 2: Build to verify it compiles.**

Run: `cd native && cargo build`
Expected: compiles (warnings about unused `run_migrations` fields are fine until later tasks wire them).

- [ ] **Step 3: Commit.**

```bash
git add native/src/db/schema.rs
git commit -m "feat(jira): add idempotent column migration for jira fields"
```

### Task A2: Extend models with JIRA types + task/settings fields

**Files:**
- Modify: `native/src/models.rs`

- [ ] **Step 1: Add the three task fields** to `TaskSummary` (after `last_session_label`, before `review_loop_status`):

```rust
    pub jira_issue_key: Option<String>,
    pub jira_issue_summary: Option<String>,
    pub jira_issue_url: Option<String>,
```

- [ ] **Step 2: Add settings fields** to both `AppSettings` and `AppSettingsInput` (after `default_branch_prefix`):

```rust
    pub jira_board_jql: Option<String>,
    pub jira_site_url: Option<String>,
```

- [ ] **Step 3: Add JIRA types** at the end of the GitHub-types region:

```rust
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
pub struct JiraWorkItem {
    pub key: String,
    pub summary: String,
    pub status_name: String,
    pub status_category: JiraStatusCategory,
    pub issue_type: Option<String>,
    pub assignee: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
}
```

- [ ] **Step 4: Build.** Run: `cd native && cargo build`. Expected: fails in `db/rows.rs` (missing fields) — that is the next task. (If you want a clean build first, do A3 before building.)

## Phase A (cont.) — wire row mapping + db methods

### Task A3: Map the new columns in row readers

**Files:**
- Modify: `native/src/db/rows.rs`

- [ ] **Step 1:** In `task_from_row`, the current SELECT order ends with `... created_at(17), updated_at(18), rl.status(19)`. New task columns will be appended to SELECTs as indices 20,21,22 (see A4). Add:

```rust
        jira_issue_key: row.get(20)?,
        jira_issue_summary: row.get(21)?,
        jira_issue_url: row.get(22)?,
```

Insert these in the struct literal (anywhere valid; keep near the other optional fields). Keep `review_loop_status: row.get(19)?`.

- [ ] **Step 2:** In `app_settings_from_row`, append (the settings SELECT in A4 adds them as indices 6,7):

```rust
        jira_board_jql: row.get(6)?,
        jira_site_url: row.get(7)?,
```

### Task A4: Extend db SELECT/UPDATE statements + add `set_task_jira_link`

**Files:**
- Modify: `native/src/db/mod.rs`

- [ ] **Step 1:** In `get_app_settings`, change the SELECT to include the two columns at the end:

```sql
SELECT default_agent_profile_id, default_worktree_root_pattern, default_branch_prefix, theme, density, updated_at, jira_board_jql, jira_site_url
FROM app_settings WHERE id = 1
```

- [ ] **Step 2:** In `update_app_settings`, persist the two fields (trim → null if empty). Add before the `UPDATE`:

```rust
        let jira_board_jql = settings
            .jira_board_jql
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let jira_site_url = settings
            .jira_site_url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
```

Extend the `UPDATE` `SET` clause and `params!` to set `jira_board_jql = ?7, jira_site_url = ?8` and bind `jira_board_jql, jira_site_url` (renumber `WHERE id = 1` stays a literal; current params end at `updated_at = ?6`).

- [ ] **Step 3:** In `list_tasks` and `task_by_id`, append `t.jira_issue_key, t.jira_issue_summary, t.jira_issue_url` to BOTH SELECT column lists (after `rl.status`). They land at indices 20,21,22 used in A3.

- [ ] **Step 4:** Add a method:

```rust
    pub fn set_task_jira_link(
        &self,
        task_id: i64,
        key: Option<String>,
        summary: Option<String>,
        url: Option<String>,
    ) -> Result<TaskSummary, String> {
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found".to_string())?;
        self.conn
            .execute(
                "UPDATE tasks SET jira_issue_key = ?1, jira_issue_summary = ?2, jira_issue_url = ?3, updated_at = ?4 WHERE id = ?5",
                params![key, summary, url, now(), task_id],
            )
            .map_err(|error| format!("Failed to update JIRA link: {error}"))?;
        self.task_by_id(task_id)?
            .ok_or_else(|| "Task not found after update".into())
    }
```

- [ ] **Step 5: Build + run existing tests.**

Run: `cd native && cargo test`
Expected: PASS (existing tests still construct `TaskSummary` via `task_from_row`; `create_task_record` unchanged, so its call sites are unaffected).

- [ ] **Step 6: Add a persistence test** in `native/src/db/tests.rs` (append):

```rust
    #[test]
    fn persists_jira_link_and_settings_round_trip() {
        let db = Database::open_in_memory().unwrap();
        let repo = {
            let dir = tempfile::tempdir().unwrap();
            std::process::Command::new("git").arg("init").arg(dir.path()).output().unwrap();
            db.add_repo(dir.path().to_string_lossy().to_string()).unwrap()
        };
        let task = db
            .create_task_record(repo.id, "Linked".to_string(), None, None, false, None)
            .unwrap();
        assert_eq!(task.jira_issue_key, None);

        let linked = db
            .set_task_jira_link(
                task.id,
                Some("PROJ-7".to_string()),
                Some("Fix login".to_string()),
                Some("https://x.atlassian.net/browse/PROJ-7".to_string()),
            )
            .unwrap();
        assert_eq!(linked.jira_issue_key.as_deref(), Some("PROJ-7"));
        assert_eq!(db.task_by_id(task.id).unwrap().unwrap().jira_issue_summary.as_deref(), Some("Fix login"));

        let mut input = settings_input_from(&db.get_app_settings().unwrap());
        input.jira_board_jql = Some("project = PROJ".to_string());
        let saved = db.update_app_settings(input).unwrap();
        assert_eq!(saved.jira_board_jql.as_deref(), Some("project = PROJ"));
    }
```

If a `settings_input_from` helper does not already exist in `tests.rs`, add one that copies the six base fields from `AppSettings` into `AppSettingsInput` with `jira_board_jql: None, jira_site_url: None`. (Check the file first — the existing settings tests likely already build an `AppSettingsInput`; reuse their pattern.)

Run: `cd native && cargo test persists_jira_link`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add native/src/models.rs native/src/db
git commit -m "feat(jira): persist task<->story link and board settings"
```

## Phase B — `acli` shell-out layer

### Task B1: Create `native/src/jira.rs` with parsers + runners

**Files:**
- Create: `native/src/jira.rs`
- Modify: `native/src/lib.rs` (add `mod jira;`)

> NOTE: `acli`'s exact `--json` shape is confirmed against real output at runtime; parsers are written tolerantly and unit-tested with synthetic JSON, exactly like `github.rs`.

- [ ] **Step 1:** Add `mod jira;` to the module list at the top of `native/src/lib.rs` (after `mod github;`).

- [ ] **Step 2:** Write `native/src/jira.rs`:

```rust
use crate::models::{JiraStatus, JiraStatusCategory, JiraWorkItem};
use crate::process_util::{command_error, resolve_executable};
use serde::Deserialize;
use std::process::{Command, Output};

/// Tolerant raw shape of a work item in `acli jira workitem search --json` /
/// `view --json`. Field names are confirmed against real `acli` output; unknown
/// extra fields are ignored and every field is optional so a shape drift degrades
/// gracefully rather than dropping the whole board.
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

#[derive(Debug, Deserialize)]
struct RawStatus {
    name: Option<String>,
    #[serde(rename = "statusCategory")]
    status_category: Option<RawStatusCategory>,
}

#[derive(Debug, Deserialize)]
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
    // acli/JIRA categories: "new"/"to do", "indeterminate"/"in progress", "done".
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
    let assignee = fields.as_ref().and_then(|f| f.assignee.as_ref()).and_then(|a| {
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

// RawStatus needs Clone because it is read from either top-level or fields.
impl Clone for RawStatus {
    fn clone(&self) -> Self {
        RawStatus {
            name: self.name.clone(),
            status_category: self.status_category.as_ref().map(|c| RawStatusCategory {
                key: c.key.clone(),
                name: c.name.clone(),
            }),
        }
    }
}

/// Parse `acli jira workitem search --json`. Accepts either a top-level array or
/// an object wrapping the array under common keys (`workItems`/`issues`/`values`).
pub fn parse_work_items(json: &str) -> Result<Vec<JiraWorkItem>, String> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Search {
        List(Vec<RawWorkItem>),
        Wrapped {
            #[serde(alias = "workItems", alias = "issues", alias = "values", alias = "results")]
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

/// Extract the active site/account from `acli jira auth status` text output.
pub fn parse_auth_site(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find_map(|line| line.split(['/', ' ']).find(|t| t.ends_with(".atlassian.net")))
        .map(str::to_string)
}

fn run_acli(args: &[&str]) -> Result<Output, String> {
    // Resolve `acli` against PATH + common install dirs (GUI-launched apps get a
    // minimal PATH). Like `gh`, `acli` is a single binary that spawns no node, so
    // it needs resolution but not `augmented_path`.
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
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !installed {
        return JiraStatus { installed: false, authenticated: false, account: None, site: None };
    }
    let auth = run_acli(&["jira", "auth", "status"]);
    let authenticated = auth.as_ref().map(|o| o.status.success()).unwrap_or(false);
    let site = auth
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| parse_auth_site(&String::from_utf8_lossy(&o.stdout)));
    JiraStatus { installed: true, authenticated, account: site.clone(), site }
}

pub fn search(jql: &str, limit: u32) -> Result<Vec<JiraWorkItem>, String> {
    let limit = limit.to_string();
    let output = run_acli(&["jira", "workitem", "search", "--jql", jql, "--json", "--limit", &limit])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem search failed"));
    }
    parse_work_items(&String::from_utf8_lossy(&output.stdout))
}

pub fn view(key: &str) -> Result<JiraWorkItem, String> {
    let output = run_acli(&["jira", "workitem", "view", key, "--json"])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem view failed"));
    }
    parse_work_item(&String::from_utf8_lossy(&output.stdout))
}

pub fn transition(key: &str, status: &str) -> Result<(), String> {
    let output = run_acli(&["jira", "workitem", "transition", "--key", key, "--status", status, "--yes"])?;
    if !output.status.success() {
        return Err(command_error(&output, "acli jira workitem transition failed"));
    }
    Ok(())
}

pub fn assign(key: &str, assignee: &str) -> Result<(), String> {
    let output = run_acli(&["jira", "workitem", "assign", "--key", key, "--assignee", assignee])?;
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
        assert_eq!(parse_auth_site("Not logged in"), None);
    }
}
```

- [ ] **Step 3: Run the parser tests.**

Run: `cd native && cargo test --lib jira`
Expected: all `jira::tests` PASS.

- [ ] **Step 4: Commit.**

```bash
git add native/src/jira.rs native/src/lib.rs
git commit -m "feat(jira): add acli shell-out layer with json parsers"
```

## Phase C — Tauri commands

### Task C1: Add `jira_*` commands + extend `create_task`

**Files:**
- Modify: `native/src/lib.rs`

- [ ] **Step 1:** Extend the `use crate::models::{...}` import with `JiraStatus, JiraWorkItem`.

- [ ] **Step 2:** Extend `create_task` to accept and apply the optional link:

```rust
#[tauri::command]
fn create_task(
    repo_id: i64,
    title: String,
    prompt: Option<String>,
    agent_profile_id: Option<i64>,
    has_worktree: Option<bool>,
    branch_name: Option<String>,
    jira_issue_key: Option<String>,
    jira_issue_summary: Option<String>,
    jira_issue_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    let db = state.db.lock();
    let task = db.create_task_record(
        repo_id, title, prompt, agent_profile_id, has_worktree.unwrap_or(false), branch_name,
    )?;
    if jira_issue_key.is_some() {
        return Ok(db.set_task_jira_link(task.id, jira_issue_key, jira_issue_summary, jira_issue_url)?);
    }
    Ok(task)
}
```

- [ ] **Step 3:** Add the JIRA commands (place after the github commands). `search` reads the board JQL from settings when none is passed:

```rust
#[tauri::command]
async fn jira_status() -> AppResult<JiraStatus> {
    tauri::async_runtime::spawn_blocking(jira::status)
        .await
        .map_err(|error| AppError::from(format!("Failed to query JIRA status: {error}")))
}

#[tauri::command]
async fn jira_search_board(state: State<'_, AppState>) -> AppResult<Vec<JiraWorkItem>> {
    let jql = {
        let db = state.db.lock();
        db.get_app_settings()?
            .jira_board_jql
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::from("Set a board JQL in Settings to load the JIRA board"))?
    };
    tauri::async_runtime::spawn_blocking(move || jira::search(&jql, 200))
        .await
        .map_err(|error| AppError::from(format!("Failed to load JIRA board: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_get_work_item(key: String) -> AppResult<JiraWorkItem> {
    tauri::async_runtime::spawn_blocking(move || jira::view(&key))
        .await
        .map_err(|error| AppError::from(format!("Failed to load work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_transition_work_item(key: String, status: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || jira::transition(&key, &status))
        .await
        .map_err(|error| AppError::from(format!("Failed to transition work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_assign_work_item(key: String, assignee: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || jira::assign(&key, &assignee))
        .await
        .map_err(|error| AppError::from(format!("Failed to assign work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
async fn jira_comment_work_item(key: String, body: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || jira::comment(&key, &body))
        .await
        .map_err(|error| AppError::from(format!("Failed to comment on work item: {error}")))?
        .map_err(Into::into)
}

#[tauri::command]
fn set_task_jira_link(
    task_id: i64,
    key: Option<String>,
    summary: Option<String>,
    url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TaskSummary> {
    app_result(state.db.lock().set_task_jira_link(task_id, key, summary, url))
}
```

- [ ] **Step 4:** Register all new commands in `tauri::generate_handler![...]` (add after `detect_github_pull_request`):

```rust
            jira_status,
            jira_search_board,
            jira_get_work_item,
            jira_transition_work_item,
            jira_assign_work_item,
            jira_comment_work_item,
            set_task_jira_link,
```

- [ ] **Step 5: Build + test.** Run: `cd native && cargo test`. Expected: PASS (`create_task` is exercised by the frontend; the Rust tests call `create_task_record` directly, unaffected).

- [ ] **Step 6: Run `cargo fmt` then revert vendored codex churn.**

Run: `cd native && cargo fmt`
Then: `git checkout -- src/sessions/codex.rs` (per repo convention: `cargo fmt` reformats the vendored file; revert it).

- [ ] **Step 7: Commit.**

```bash
git add native/src/lib.rs
git commit -m "feat(jira): expose jira tauri commands and task link"
```

## Phase D — Frontend types + API

### Task D1: Mirror types and add API wrappers

**Files:**
- Modify: `src/types.ts`, `src/api.ts`

- [ ] **Step 1:** In `src/types.ts` add to `TaskSummary` (after `reviewLoopStatus`):

```ts
  jiraIssueKey?: string | null;
  jiraIssueSummary?: string | null;
  jiraIssueUrl?: string | null;
```

Add to `AppSettings` and `AppSettingsInput` (after `defaultBranchPrefix`):

```ts
  jiraBoardJql?: string | null;
  jiraSiteUrl?: string | null;
```

Add new types:

```ts
export type JiraStatusCategory = "to_do" | "in_progress" | "done" | "unknown";

export interface JiraStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string | null;
  site?: string | null;
}

export interface JiraWorkItem {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: JiraStatusCategory;
  issueType?: string | null;
  assignee?: string | null;
  url?: string | null;
  description?: string | null;
}
```

- [ ] **Step 2:** In `src/api.ts`, extend the `createTask` input with optional jira fields and pass them; add jira methods. Update the import to include `JiraStatus, JiraWorkItem`. Add to `createTask` input type `jiraIssueKey?`, `jiraIssueSummary?`, `jiraIssueUrl?` and to the `invoke` payload `jiraIssueKey: input.jiraIssueKey ?? null` (and the other two). Add:

```ts
  async jiraStatus(): Promise<JiraStatus> {
    if (!isTauri) return { installed: false, authenticated: false, account: null, site: null };
    return invoke("jira_status");
  },
  async jiraSearchBoard(): Promise<JiraWorkItem[]> {
    if (!isTauri) return [];
    return invoke("jira_search_board");
  },
  async jiraGetWorkItem(key: string): Promise<JiraWorkItem> {
    return invoke("jira_get_work_item", { key });
  },
  async jiraTransitionWorkItem(key: string, status: string): Promise<void> {
    return invoke("jira_transition_work_item", { key, status });
  },
  async jiraAssignWorkItem(key: string, assignee: string): Promise<void> {
    return invoke("jira_assign_work_item", { key, assignee });
  },
  async jiraCommentWorkItem(key: string, body: string): Promise<void> {
    return invoke("jira_comment_work_item", { key, body });
  },
  async setTaskJiraLink(input: { taskId: number; key?: string | null; summary?: string | null; url?: string | null }): Promise<TaskSummary> {
    return invoke("set_task_jira_link", {
      taskId: input.taskId,
      key: input.key ?? null,
      summary: input.summary ?? null,
      url: input.url ?? null,
    });
  },
```

- [ ] **Step 3:** Run `pnpm install` if needed, then `pnpm build`. Expected: type-checks (no consumers yet of new fields → OK). Commit.

```bash
git add src/types.ts src/api.ts
git commit -m "feat(jira): frontend types and api bindings"
```

## Phase E — `useJira` hook

### Task E1: Board state + actions

**Files:**
- Create: `src/hooks/useJira.ts`
- Test: `src/test/useJiraTests.tsx` (column grouping helper)

- [ ] **Step 1:** Write a pure grouping helper + hook. Put the grouping helper as an exported function so it can be unit-tested without the Tauri bridge:

```ts
import { useCallback, useState } from "react";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import type { JiraStatus, JiraStatusCategory, JiraWorkItem } from "../types";

export interface JiraColumn {
  statusName: string;
  category: JiraStatusCategory;
  items: JiraWorkItem[];
}

const CATEGORY_ORDER: Record<JiraStatusCategory, number> = {
  to_do: 0,
  in_progress: 1,
  done: 2,
  unknown: 3,
};

/** Auto-derive columns from the statuses present, ordered by category then name. */
export function deriveColumns(items: JiraWorkItem[]): JiraColumn[] {
  const byStatus = new Map<string, JiraColumn>();
  for (const item of items) {
    const existing = byStatus.get(item.statusName);
    if (existing) existing.items.push(item);
    else byStatus.set(item.statusName, { statusName: item.statusName, category: item.statusCategory, items: [item] });
  }
  return [...byStatus.values()].sort((a, b) => {
    const byCat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return byCat !== 0 ? byCat : a.statusName.localeCompare(b.statusName);
  });
}

interface UseJiraInput {
  active: boolean;
  setMessage: (message: string | null) => void;
}

export function useJira({ active, setMessage }: UseJiraInput) {
  const [jiraStatus, setJiraStatus] = useState<JiraStatus>();
  const [items, setItems] = useState<JiraWorkItem[]>([]);
  const [loading, setLoading] = useState(false);

  useAsyncEffect(async (alive) => {
    try {
      const status = await api.jiraStatus();
      if (alive()) setJiraStatus(status);
    } catch {
      if (alive()) setJiraStatus({ installed: false, authenticated: false, account: null, site: null });
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.jiraSearchBoard());
    } catch (error) {
      setItems([]);
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  // Refresh whenever the JIRA view becomes active and the CLI is connected.
  const ready = Boolean(jiraStatus?.installed && jiraStatus?.authenticated);
  useAsyncEffect(async (alive) => {
    if (!active || !ready) return;
    if (!alive()) return;
    await refresh();
  }, [active, ready, refresh]);

  const transition = useCallback(
    async (item: JiraWorkItem, statusName: string) => {
      // Optimistic: move locally, revert on failure.
      const previous = item.statusName;
      setItems((current) =>
        current.map((it) => (it.key === item.key ? { ...it, statusName } : it)),
      );
      try {
        await api.jiraTransitionWorkItem(item.key, statusName);
        await refresh();
      } catch (error) {
        setItems((current) =>
          current.map((it) => (it.key === item.key ? { ...it, statusName: previous } : it)),
        );
        setMessage(String(error));
      }
    },
    [refresh, setMessage],
  );

  const comment = useCallback(
    async (key: string, body: string) => {
      try {
        await api.jiraCommentWorkItem(key, body);
        setMessage("Comment added");
      } catch (error) {
        setMessage(String(error));
      }
    },
    [setMessage],
  );

  const assign = useCallback(
    async (key: string, assignee: string) => {
      try {
        await api.jiraAssignWorkItem(key, assignee);
        await refresh();
      } catch (error) {
        setMessage(String(error));
      }
    },
    [refresh, setMessage],
  );

  return { jiraStatus, ready, items, columns: deriveColumns(items), loading, refresh, transition, comment, assign };
}
```

- [ ] **Step 2:** Write `src/test/useJiraTests.tsx` testing `deriveColumns` ordering and grouping (To Do before In Progress before Done; same-category sorted by name; multiple items grouped). Follow the existing `src/test/*Tests.tsx` registration pattern (check `src/App.test.tsx` and one `app*Tests.tsx` file for how `describe`/`it` blocks are exported and registered; if those files export a registrar function, mirror it; otherwise a standalone `describe` in this file is picked up by Vitest).

```tsx
import { describe, it, expect } from "vitest";
import { deriveColumns } from "../hooks/useJira";
import type { JiraWorkItem } from "../types";

const item = (key: string, statusName: string, statusCategory: JiraWorkItem["statusCategory"]): JiraWorkItem => ({
  key, summary: key, statusName, statusCategory, issueType: null, assignee: null, url: null, description: null,
});

describe("deriveColumns", () => {
  it("orders columns by category then name and groups items", () => {
    const cols = deriveColumns([
      item("A-1", "Done", "done"),
      item("A-2", "Backlog", "to_do"),
      item("A-3", "Selected", "to_do"),
      item("A-4", "Backlog", "to_do"),
    ]);
    expect(cols.map((c) => c.statusName)).toEqual(["Backlog", "Selected", "Done"]);
    expect(cols[0].items.map((i) => i.key)).toEqual(["A-2", "A-4"]);
  });
});
```

- [ ] **Step 3:** Run: `pnpm test useJira`. Expected: PASS. Commit.

```bash
git add src/hooks/useJira.ts src/test/useJiraTests.tsx
git commit -m "feat(jira): useJira hook with auto-derived columns"
```

## Phase F — JIRA view UI

### Task F1: `JiraBoardPage` + work-item dialog

**Files:**
- Create: `src/components/JiraBoardPage.tsx`, `src/components/JiraWorkItemDialog.tsx`

- [ ] **Step 1: `JiraBoardPage`.** Header shows connection status + JQL field (reads `settings.jiraBoardJql`, saved through `onSaveSettings`) + Refresh. Body renders `Empty` states for not-installed / not-authenticated / no-JQL, else the columns. Each column is a drop target; each card is draggable and opens the dialog on click. Use shadcn `Card`, `Badge`, `Button`, `ScrollArea`, `Empty`, `Skeleton`. For drag, use native HTML5 DnD (`draggable`, `onDragStart` setting the item key, `onDrop` calling `onTransition(item, column.statusName)`), which is the lightest approach and adequate for V1. Provide a `data-testid="jira-board"` on the root.

Props:

```tsx
interface JiraBoardPageProps {
  status: JiraStatus | undefined;
  columns: JiraColumn[];
  loading: boolean;
  boardJql: string;
  onChangeJql: (jql: string) => void;
  onRefresh: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}
```

Render the not-connected guidance exactly like `GitHubPanel`: if `!status?.installed` → "Install the Atlassian CLI (acli)"; else if `!status.authenticated` → "Run `acli jira auth login`"; else if `!boardJql.trim()` → "Set a board JQL to load stories".

- [ ] **Step 2: `JiraWorkItemDialog`.** shadcn `Dialog`. Shows key (link out via `api.openExternalUrl`), summary, status, type, assignee, description. Controls: a status `Select` (options = the distinct column status names passed in) calling `onTransition`; an assignee `Input` + Assign button; a comment `Textarea` + Comment button; and a primary "Create task from this story" button calling `onCreateTask`. Keep it focused; no inline edit of summary in V1 beyond what `acli edit` covers later.

Props:

```tsx
interface JiraWorkItemDialogProps {
  item: JiraWorkItem | null;
  statusOptions: string[];
  onClose: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onAssign: (key: string, assignee: string) => void;
  onComment: (key: string, body: string) => void;
  onCreateTask: (item: JiraWorkItem) => void;
  onOpenUrl: (url: string) => void;
}
```

- [ ] **Step 3:** `pnpm build` to type-check both components in isolation (not yet mounted). Commit.

```bash
git add src/components/JiraBoardPage.tsx src/components/JiraWorkItemDialog.tsx
git commit -m "feat(jira): board page and work-item dialog components"
```

## Phase G — Wire the view + create-from-story

### Task G1: Form gains repo id + pending jira link

**Files:**
- Modify: `src/hooks/useCreateTaskForm.ts`

- [ ] **Step 1:** Read the current `useCreateTaskForm` (not shown here — read it first). Add state: `newTaskRepoId: number | undefined` / `setNewTaskRepoId`, and `pendingJiraLink: { key: string; summary: string; url: string | null } | null` / `setPendingJiraLink`. Reset both in `resetCreateTaskForm`. Export them from the hook's return.

### Task G2: `useApp` wires `useJira`, the `"jira"` view, and create-from-story

**Files:**
- Modify: `src/hooks/useApp.ts`

- [ ] **Step 1:** Change the view union: `useState<"dashboard" | "settings" | "reviews" | "jira">("dashboard")`.

- [ ] **Step 2:** After the `useGithub` wiring, add:

```ts
const jira = useJira({ active: currentView === "jira", setMessage });
```

- [ ] **Step 3:** Add `createTaskFromStory`:

```ts
const createTaskFromStory = useCallback(
  async (item: JiraWorkItem) => {
    setNewTaskTitle(item.summary);
    let description = item.description ?? "";
    if (!description) {
      try {
        description = (await api.jiraGetWorkItem(item.key)).description ?? "";
      } catch {
        // best-effort: leave prompt blank if the fetch fails
      }
    }
    setNewTaskPrompt(description);
    setPendingJiraLink({ key: item.key, summary: item.summary, url: item.url ?? null });
    setNewTaskRepoId(selectedRepoId ?? repos[0]?.id);
    setCurrentView("dashboard");
    setCreateTaskOpen(true);
  },
  [repos, selectedRepoId, setNewTaskTitle, setNewTaskPrompt, setPendingJiraLink, setNewTaskRepoId, setCreateTaskOpen],
);
```

- [ ] **Step 4:** In `createTask`, replace `selectedRepoId` usage with `const repoId = newTaskRepoId ?? selectedRepoId;` (guard `if (!repoId) return;`), pass `repoId` to `api.createTask`, and include the link:

```ts
const task = await api.createTask({
  repoId,
  title: getGeneratedTaskTitle(),
  prompt: newTaskPrompt.trim() || null,
  agentProfileId,
  hasWorktree: newTaskHasWorktree,
  branchName,
  jiraIssueKey: pendingJiraLink?.key ?? null,
  jiraIssueSummary: pendingJiraLink?.summary ?? null,
  jiraIssueUrl: pendingJiraLink?.url ?? null,
});
```

Keep `await refresh(repoId)`.

- [ ] **Step 5:** Add a `setTaskJiraLink` action (for detach/change from the inspector):

```ts
const setTaskJiraLink = (taskId: number, link: { key: string; summary: string; url: string | null } | null) =>
  run(async () => {
    const updated = await api.setTaskJiraLink({
      taskId,
      key: link?.key ?? null,
      summary: link?.summary ?? null,
      url: link?.url ?? null,
    });
    setTasks((current) => replaceById(current, updated));
  });
```

- [ ] **Step 6:** Return the new values from `useApp`: spread `jira` board fields (`jiraStatus: jira.jiraStatus`, `jiraColumns: jira.columns`, `jiraLoading: jira.loading`, `jiraReady: jira.ready`, `refreshJira: jira.refresh`, `transitionJira: jira.transition`, `assignJira: jira.assign`, `commentJira: jira.comment`), plus `createTaskFromStory`, `setTaskJiraLink`, and the form's `newTaskRepoId/setNewTaskRepoId`. Import `useJira`, `JiraWorkItem`, and `api` is already imported.

### Task G3: Sidebar button, App view branch, modal repo picker

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/CreateTaskModal.tsx`

- [ ] **Step 1: Sidebar.** Add props `onOpenJira: () => void; jiraActive: boolean;`. Add a footer `SidebarMenuItem` above "PR Reviews" with a JIRA label and an icon (reuse an existing hugeicon, e.g. `DashboardSquare01Icon` or `KanbanIcon` if present; otherwise `GitPullRequestIcon` is acceptable as a placeholder — keep it distinct from PR Reviews). Wire `isActive={jiraActive}` + `onClick={onOpenJira}`.

- [ ] **Step 2: App.tsx.** Destructure the new fields from `useApp`. Add to the Sidebar element: `jiraActive={currentView === "jira"}` and `onOpenJira={() => { setCurrentView("jira"); setSelectedTaskId(undefined); }}`. Add a branch in the content area: when `currentView === "jira"`, render `<JiraBoardPage .../>` wired to the `useApp` jira fields, with `boardJql={settings?.jiraBoardJql ?? ""}`, `onChangeJql` calling `saveAppSettings` with the merged settings, `onOpenItem`/`onCreateTask` opening the dialog and `createTaskFromStory`. Manage `selectedJiraItem` local state in App (or in useApp) for the dialog. Pass `repos` to `CreateTaskModal`.

- [ ] **Step 3: CreateTaskModal.** Add props `repos: Repo[]; newTaskRepoId: number | undefined; setNewTaskRepoId: (id: number) => void;`. Add a shadcn `Select` (project) as the first field, defaulting to `newTaskRepoId`. When `pendingJiraLink` is set the surrounding flow already pre-fills title/prompt; show a small `Badge` "Linked to <key>" in the header when the title was seeded from a story (optional: pass an `linkedKey?: string | null` prop).

- [ ] **Step 4: Build.** Run: `pnpm build`. Fix any type errors. Then `pnpm test`. Expected: existing tests pass (the modal now needs `repos`; update any test that renders it — search `CreateTaskModal` in `src/test`).

- [ ] **Step 5: Commit.**

```bash
git add src/hooks/useApp.ts src/hooks/useCreateTaskForm.ts src/components/Sidebar.tsx src/App.tsx src/components/CreateTaskModal.tsx
git commit -m "feat(jira): wire jira view, sidebar nav, and create-from-story"
```

## Phase H — Link surfacing on existing surfaces

### Task H1: Badge on task rows/cards + JiraPanel in the workspace

**Files:**
- Create: `src/components/JiraPanel.tsx`
- Modify: `src/components/TaskRow.tsx`, `src/components/TaskCard.tsx`, `src/App.tsx` (pass JiraPanel into `TaskWorkspace`) and `src/components/TaskWorkspace.tsx`

- [ ] **Step 1:** Read `TaskRow.tsx` and `TaskCard.tsx`; add a small shadcn `Badge` showing `task.jiraIssueKey` when present (tooltip = `jiraIssueSummary`).

- [ ] **Step 2:** `JiraPanel.tsx`: given `task`, show the linked key (link out), summary, and a "Detach" button calling `onSetLink(task.id, null)`. If unlinked, render nothing (or a subtle "Link a JIRA story" affordance is out of scope for V1 — keep it display + detach only).

- [ ] **Step 3:** Read `TaskWorkspace.tsx`; render `<JiraPanel>` next to the GitHub panel, threading `onSetLink` from `useApp.setTaskJiraLink` through App → TaskWorkspace.

- [ ] **Step 4:** `pnpm build && pnpm test`. Commit.

```bash
git add src/components/JiraPanel.tsx src/components/TaskRow.tsx src/components/TaskCard.tsx src/components/TaskWorkspace.tsx src/App.tsx
git commit -m "feat(jira): surface linked story on task row, card, and workspace"
```

## Phase I — Docs + full verification

### Task I1: Documentation

**Files:**
- Create: `docs/jira-integration.md`
- Modify: `CLAUDE.md`, `docs/features.md`, `README.md`

- [ ] **Step 1:** Write `docs/jira-integration.md` mirroring `docs/github-integration.md`: the `acli` connection model (`acli jira auth login`/`status`, no stored tokens), the board JQL setting, the work-item commands used, auto-derived columns, optimistic drag-to-transition, and the key caveat (acli exposes no transitions/status enumeration). Document the local-only link model.

- [ ] **Step 2:** Update `CLAUDE.md`: add `native/src/jira.rs` to Backend Boundaries; list the new `jira_*` + `set_task_jira_link` commands; add an `acli` bullet under "Spawning External CLIs" call sites (resolve via `resolve_executable`; no `augmented_path` — spawns no node, like `gh`); add `docs/jira-integration.md` to the Documentation Map.

- [ ] **Step 3:** Update `docs/features.md` (the JIRA view, board behavior, create-from-story, link surfacing) and `README.md` (onboarding note: JIRA view requires `acli` + `acli jira auth login`).

- [ ] **Step 4: Commit.**

```bash
git add docs CLAUDE.md README.md
git commit -m "docs(jira): document the JIRA board view and acli integration"
```

### Task I2: Full verification gate

- [ ] **Step 1:** `pnpm test` → PASS.
- [ ] **Step 2:** `pnpm build` → PASS.
- [ ] **Step 3:** `cd native && cargo test` → PASS.
- [ ] **Step 4:** `cd native && cargo fmt --check` (or run `cargo fmt` then `git checkout -- src/sessions/codex.rs`). Optionally `cargo clippy`.
- [ ] **Step 5:** Final commit if formatting changed.

---

## Self-Review notes (gaps closed during planning)

- **Migration:** base schema is `CREATE TABLE IF NOT EXISTS` with no migration runner → Task A1 adds an idempotent `ALTER TABLE` path so existing DBs gain the columns.
- **`create_task_record` signature kept stable** (existing Rust tests call it positionally) → the link is applied via `set_task_jira_link` inside the `create_task` command (Task C1), not by changing the record fn.
- **Repo picker gap:** `CreateTaskModal` had no repo selector; the global JIRA board needs one → Tasks G1/G3 add `newTaskRepoId` + a project `Select`.
- **acli JSON shape uncertainty:** parsers are tolerant (top-level array or wrapped, flat or `fields`-nested, optional everything) and unit-tested with synthetic JSON; real shape is confirmed at runtime — the only place that touches it is `jira.rs`.
- **Columns from CLI only:** `deriveColumns` builds columns purely from returned items (auto-derived, per the locked decision); empty statuses produce no column by design.
- **Drag transition is optimistic:** `useJira.transition` moves locally then reverts + toasts on `acli` workflow rejection.
