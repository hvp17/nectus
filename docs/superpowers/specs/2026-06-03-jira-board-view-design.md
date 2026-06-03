# JIRA Board View — Design

**Status:** Approved design, pre-implementation
**Date:** 2026-06-03
**Scope:** Add a first-class JIRA board view to Nectus Desktop, backed by the official Atlassian CLI (`acli`), with the ability to attach Codex/Claude tasks (sessions) to JIRA work items.

---

## 1. Goal & intent

Nectus Desktop today is repo-centric: a task (a Codex/Claude/Gemini session) belongs to one local git repo. This feature adds a **JIRA view** as a peer of the existing Dashboard, Settings, and Reviews views. The JIRA view is a genuine working surface — a "home base" you can start work from — where you can browse and **fully manage** JIRA work items, and turn a story into a Nectus task.

This is explicitly a **full JIRA client** for the configured board, not a read-only widget. The existing task view and review view do not change or disappear.

## 2. Locked decisions

These were settled during brainstorming and constrain the rest of the design:

1. **Full management.** Create, view, edit, transition, assign, and comment on work items from inside Nectus. Not read-only.
2. **Integration via `acli`** (official Atlassian CLI). `acli` owns authentication (`acli jira auth login`); Nectus stores **no tokens and runs no OAuth** — the same bargain already accepted for the `gh` CLI. This preserves the CLAUDE.md product principle ("the app stores no GitHub tokens and runs no OAuth flow … do not introduce app-managed OAuth or token storage"), extended to JIRA.
3. **Single Atlassian site for V1.** Whatever `acli jira auth login` is pointed at. Multi-site/account switching is out of scope.
4. **Board is its own world.** Global and JQL-defined, *not* tied to repos. Selecting a repo does not filter the JIRA view.
5. **Repo chosen at attach time.** When a story becomes a task, the user picks the destination repo (and worktree/agent) right then.
6. **Attach = local link only.** Creating a task from a story writes **nothing** to JIRA. Every JIRA mutation (transition, edit, comment, create, assign) is an **explicit** user action in the board view. The link is stored locally on the task.
7. **Board defined by a raw JQL string** the user configures. No guided builder, no saved views in V1.
8. **Columns auto-derived** from the statuses present in the JQL results, ordered by JIRA `statusCategory` (To Do → In Progress → Done). No manual column list.
9. **Drag-to-transition, optimistic.** Dragging a card to a column calls `acli jira workitem transition`. On workflow rejection, the card reverts and a toast surfaces the error.

## 3. `acli` capability basis (verified against current Atlassian docs)

The design relies only on commands confirmed to exist:

- **Auth (self-owned):** `acli jira auth login`, `acli jira auth status`.
- **Search (board load):** `acli jira workitem search --jql "<jql>" --json` (also supports `--limit`, `--fields`, `--csv`, `--count`, `--paginate`). This is the **only** source of status names — see the constraint below.
- **View one item:** `acli jira workitem view <key> [flags]`.
- **Create:** `acli jira workitem create …`, `acli jira workitem create-bulk --from-json <file>`.
- **Edit:** `acli jira workitem edit --key <k> …` / `--jql "<jql>"` (e.g. `--assignee`).
- **Transition:** `acli jira workitem transition --key "K-1,K-2" --status "<status>" --json --yes` (also `--jql`, `--ignore-errors`).
- **Assign:** `acli jira workitem assign --key <k> --assignee <user>`.
- **Comment:** `acli jira workitem comment --key <k> --body "<text>"` (also `--body-file`, `--editor`, `--edit-last`).

**Key constraint:** `acli` exposes **no command to enumerate a project's status set or a work item's valid transitions.** Consequences baked into the design:

- **Columns can only come from the search results** (each item carries its current `status`). A status with zero matching items right now produces **no column**. This is accepted (auto-derived only; no manual override in V1).
- **Drag-to-transition is optimistic.** We cannot pre-validate that a target status is a legal transition from the card's current status, so we attempt the transition and handle rejection by reverting + toast.

**Honest caveat:** the exact field names in `acli … --json` output are confirmed against real CLI output during implementation. They are touched only inside the Rust parser functions, which are unit-tested in isolation (mirroring `native/src/github.rs`'s `parse_pull_request`).

## 4. Architecture overview

Follows the existing `gh` integration shape end-to-end:

```
Frontend (React/TS)                    Backend (Rust/Tauri)                 External
─────────────────────                  ────────────────────                 ────────
JiraBoardPage ──┐                      jira_* Tauri commands  ──► jira.rs ──► acli (owns auth)
useJira hook  ──┼─ api.ts (typed) ───► (lib.rs registration)       │
JiraPanel     ──┘                                                  └─ process_util::resolve_executable("acli")
CreateTaskModal (pre-seeded)           create_task (+ jira link)   SQLite (rusqlite): tasks.jira_*, app_settings.jira_*
```

No new Rust → frontend events. The board is pull/refresh, not push (no JIRA webhooks).

## 5. Data model & schema changes

### 5.1 `tasks` table (`native/src/db/schema.rs`)

Add three nullable columns, captured at attach time so cards/inspector render without re-querying `acli`:

| Column | Type | Notes |
|---|---|---|
| `jira_issue_key` | `TEXT` | Canonical link, e.g. `PROJ-123`. Null = unlinked. |
| `jira_issue_summary` | `TEXT` | Snapshot of the summary at attach, for badge/tooltip. |
| `jira_issue_url` | `TEXT` | Browse link. |

One additive migration. A `task` links to at most one work item; one work item may back several tasks over time.

### 5.2 `app_settings` table (`native/src/db/schema.rs`)

Add:

| Column | Type | Notes |
|---|---|---|
| `jira_board_jql` | `TEXT` | The raw JQL that defines the board. Null/empty = board not configured. |
| `jira_site_url` | `TEXT` | Optional base URL for building browse links if not present in `acli` JSON. |

### 5.3 Type mirrors

- `native/src/models.rs`: add the three fields to `TaskSummary`; add `jira_board_jql` / `jira_site_url` to `AppSettings` and `AppSettingsInput`.
- `src/types.ts`: mirror on `TaskSummary` and `AppSettings`.
- New shared types: `JiraStatus`, `JiraWorkItem` (Rust `models.rs` + `src/types.ts`).

`JiraWorkItem` (display contract): `key`, `summary`, `status` (`{ name, category }`), `issueType`, `assignee` (nullable), `url`, and `description` (nullable; typically populated by `view`, may be absent from board search payloads).
`JiraStatus`: `{ installed: bool, authenticated: bool, account: Option<String>, site: Option<String> }`.

### 5.4 Persistence test

Add a migration/round-trip test alongside the existing `native/src/db/` persistence tests.

## 6. Rust `acli` layer — `native/src/jira.rs`

New module mirroring `native/src/github.rs`. All shell-outs:

- Resolve the binary with `process_util::resolve_executable("acli")`. Like `gh`, `acli` is a single static binary that spawns no `node`, so it needs **resolution but not** `process_util::augmented_path()` (per the "Spawning External CLIs" rule in CLAUDE.md — resolve always; add `augmented_path` only for CLIs that spawn node, e.g. Codex).
- Keep JSON/text parsing in **pure functions** with unit tests (mirrors `github::parse_pull_request` / `parse_pr_url`).
- Use shared `command_error` formatting for stderr.

Functions:

| Function | `acli` invocation | Returns |
|---|---|---|
| `status()` | `acli jira auth status` (+ `--version`/install probe) | `JiraStatus` |
| `search(jql, limit)` | `acli jira workitem search --jql <jql> --json --limit N` | `Vec<JiraWorkItem>` |
| `view(key)` | `acli jira workitem view <key> --json` | `JiraWorkItem` (full) |
| `transition(key, status)` | `acli jira workitem transition --key <key> --status <status> --json --yes` | result / typed error |
| `edit(key, fields)` | `acli jira workitem edit --key <key> …` | updated item |
| `assign(key, assignee)` | `acli jira workitem assign --key <key> --assignee <user>` | updated item |
| `comment(key, body)` | `acli jira workitem comment --key <key> --body <text>` | () |
| `create(input)` | `acli jira workitem create …` | new `JiraWorkItem` |

Transition errors (workflow rejection) are returned as a typed error so the frontend can revert and toast.

## 7. Tauri commands (`native/src/lib.rs`)

Register: `jira_status`, `jira_search_board`, `jira_get_work_item`, `jira_create_work_item`, `jira_transition_work_item`, `jira_edit_work_item`, `jira_assign_work_item`, `jira_comment_work_item`.

`create_task` gains optional `jira_issue_key`, `jira_issue_summary`, `jira_issue_url` parameters (stored on the task; no JIRA write-back). Change/detach from the task inspector is handled by a dedicated `set_task_jira_link` command (key/summary/url, or null to detach) rather than overloading `update_task_metadata`, keeping the link's nullable semantics explicit.

No new emitted events.

## 8. Frontend — the JIRA view

### 8.1 Navigation

- Add `"jira"` to the `currentView` union in `src/App.tsx` and a render branch.
- Add a Sidebar nav entry (`src/components/Sidebar.tsx`).

### 8.2 `JiraBoardPage` (`src/components/`)

- **Header:** connection status, the JQL input (bound to `app_settings.jira_board_jql`), and a Refresh button.
- **Unconfigured / not-installed / not-authenticated states:** `Empty` state guiding the user to install `acli` and run `acli jira auth login`, mirroring `GitHubPanel`'s installed/authenticated handling.
- **Columns:** group results by `status.name`, order columns by `status.category` then name. Cards show key, issue type, summary, assignee, status.
- **Drag a card → column:** call `jira_transition_work_item`; optimistic move; on error revert the card and toast. Reuse the app's existing pointer-drag approach (patterns from `src/hooks/useTaskCardPointerDrag.ts`).
- **Click a card → detail dialog/sheet:** full management — transition, edit, assign, comment — plus **"Create task from this story."**

### 8.3 `useJira` hook (`src/hooks/`)

Mirrors `src/hooks/useGithub.ts`: holds `jiraStatus`, board items, and loading state; exposes `refresh`, `transition`, `edit`, `assign`, `comment`, `create`. Loads status on mount; refreshes the board on view focus and on manual Refresh. One `search` call loads the whole board (acli calls are process spawns, so minimize them).

### 8.4 shadcn primitives

`Card`, `Badge`, `Dialog`/`Sheet`, `DropdownMenu`, `Button`, `ScrollArea`, `Skeleton`, `Empty`, `sonner`. No custom reimplementations of these primitives (per the shadcn rules in CLAUDE.md).

## 9. Create-task-from-story flow

- A card's **"Create task"** action opens the existing `src/components/CreateTaskModal.tsx`, **pre-seeded**: title ← work-item summary, prompt ← work-item description (fetched via `jira_get_work_item` when the board search payload omits it; left blank if unavailable), with `jira_issue_key` (+ summary/url snapshot) carried through.
- The user still picks the **repo**, worktree, and agent in the modal (matches "repo chosen at attach time").
- On submit, `create_task` persists the JIRA link on the new task. No JIRA write-back.

## 10. Link surfacing on existing surfaces

- **`TaskCard` / `TaskRow`:** a small JIRA key `Badge` when the task is linked.
- **`TaskWorkspace`:** a compact **JIRA panel** beside the existing GitHub panel, showing the linked work item (key, summary, status) with a browse-out link and **change / detach** actions.

## 11. Refresh & error model

- **Refresh:** manual button + on view focus. No webhooks; no background polling in V1.
- **acli not installed / not authenticated:** dedicated `Empty` states with the exact remediation command.
- **Transition rejected by workflow:** revert the optimistic move, toast the `acli` error.
- **General command failure:** surface via existing message/toast plumbing (`setMessage` pattern used by `useGithub`).

## 12. Documentation & verification

**Docs (updated in the same change):**
- New `docs/jira-integration.md`, mirroring `docs/github-integration.md` (the `acli` connection model, `jira auth login`/`status`, board JQL config, work-item commands, known caveats — especially the no-transitions-enumeration constraint).
- `CLAUDE.md`: add `native/src/jira.rs` to backend boundaries, the new Tauri commands, and an `acli` entry under "Spawning External CLIs" call sites (resolve via `resolve_executable`; no `augmented_path` needed — spawns no node, like `gh`).
- `docs/features.md`: the JIRA view, board behavior, attach flow.
- `README.md`: onboarding note that the JIRA view requires `acli` + `acli jira auth login`.

**Tests / gates:**
- Rust: parser unit tests for `acli --json` output and transition errors; the schema migration/persistence test.
- Frontend: `useJira` and board-grouping tests, mirroring `useGithub` and the `src/test/app*Tests.tsx` groups.
- Run `pnpm test`, `pnpm build`, and `cd native && cargo test` before claiming completion.

## 13. Out of scope for V1 (YAGNI)

- Multi-site / multi-account switching.
- Guided JQL builder and saved/named views.
- Manual column pinning or ordering.
- Any JIRA write-back on attach (auto-transition, comments, remote links / PR back-links).
- JIRA webhooks or live push updates.
- Sprint/board-config mirroring (acli is JQL-driven; no board-config API is used).

## 14. Open implementation details (resolved during build, not blocking)

- Exact `acli … --json` field names → confirmed against real output; isolated in `jira.rs` parsers.
- Browse-URL construction: prefer a URL field in the search JSON; fall back to `jira_site_url` + key.
- Drag mechanism: reuse the existing pointer-drag patterns vs. a lightweight column DnD helper — chosen during implementation to match the existing task-board drag feel.
