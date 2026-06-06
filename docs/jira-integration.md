# JIRA Integration

Nectus integrates with JIRA through the official Atlassian CLI (`acli`). Because
`acli` owns authentication, Nectus stores no tokens and runs no OAuth flow — it
shells out to `acli` the same way it shells out to `git` and `gh`.

## Connection

- On opening the JIRA view the app checks whether `acli` is installed and
  authenticated and which site is active (`acli --version`, `acli jira auth status`).
- The board header shows connection state: the connected site, or guidance to
  install `acli` or run `acli jira auth login`.
- Connection state gates the board — the project picker and work items only appear
  once `acli` is connected and a project is chosen.
- A single Atlassian site is supported (whatever `acli jira auth login` points at).

## Optional REST layer (custom statuses)

`acli` cannot enumerate a project's statuses or a work item's valid transitions, so
custom per-project workflows are limited under acli alone. An **optional, additive**
JIRA Cloud REST layer fills that gap. It is **off by default** and gated on a
user-provided API token; acli stays the base integration for connection, board
search, create, assign, and comment.

- **Connect:** Settings → **JIRA** → *JIRA API token*. Site and email are prefilled
  from `acli jira auth status` (both editable); paste an Atlassian API token from
  `id.atlassian.com/manage/api-tokens`. The token is verified against
  `GET /rest/api/3/myself` (Basic auth, `email:token`) before anything is saved.
- **Storage:** the token is stored in the **macOS Keychain** (service =
  `com.hvp17.nectus`, account = `jira-api-token:{site}`), never in SQLite. Only the
  non-secret site/email are persisted (`app_settings.jira_site_url`,
  `app_settings.jira_rest_email`). Disconnecting deletes the Keychain entry and clears
  the email. This is a deliberate, contained exception to the "no app-managed tokens"
  default — an opt-in, user-revocable token, not OAuth.
- **What it unlocks when connected:**
  - **Legal-transition dropdown** — the work-item status dropdown shows the issue's
    valid moves from `GET /rest/api/3/issue/{key}/transitions`, and the move executes
    via `POST /rest/api/3/issue/{key}/transitions` (resolving the chosen status name to
    its transition id). Falls back to `acli ... transition` when no token.
  - **All status columns, including empty ones** — board columns are built from the
    project's full workflow status set (`GET /rest/api/3/project/{key}/statuses`,
    unioned across issue types), so empty statuses still render.
  - **Board status filter** — a multi-select in the board header (options from the
    project status set) compiled into the board JQL as `status in (...)`.
- **Degradation:** with no token, behavior is exactly as before (item-derived columns,
  acli transition). The status filter still works token-free, but its options fall back
  to the statuses currently present on the board.

## The board (no JQL to write)

The board is entirely UI-driven; no JQL is ever typed.

- The board is global — it is not tied to a repo. In the header you **pick a JIRA
  project** from a dropdown (populated by `acli jira project list --json`) and toggle
  a few filters: **My issues** (`assignee = currentUser()`), **Hide done**
  (`statusCategory != Done`, on by default), and **Current sprint**
  (`sprint in openSprints()`).
- Nectus builds the JQL from that structured config in `jira::build_board_jql`
  (e.g. `project = "PROJ" AND statusCategory != Done ORDER BY updated DESC`). The
  config is stored as `app_settings.jira_board_project` plus the three
  `jira_filter_*` flags; the generated query is never shown to the user.
- Work items load via `acli jira workitem search --jql "<built jql>" --json
  --limit 200`.
- **Columns are auto-derived** from the statuses present in the results, ordered by
  JIRA status category (To Do → In Progress → Done) then status name. `acli` exposes
  no command to enumerate a project's status set, so a status with zero matching
  items produces no column by design.
- The board refreshes when the view becomes active, when the project/filters change,
  and via the `Refresh` button. There is no background polling or webhook.

## Creating a work item

- The board toolbar has a **New work item** button (enabled once `acli` is connected
  and a project is chosen). It opens an **inline create form** in the same right-hand
  dock slot the work-item view panel uses — the two are mutually exclusive, so opening
  one closes the other (no modal, matching the rest of the JIRA surfaces).
- Fields: **Project** (defaults to the board's project; any visible project can be
  picked), **Type** (`Task`/`Bug`/`Story`/`Epic`), **Summary** (required), and optional
  **Description**, **Assignee** (email/account id, or `@me`), and comma-separated
  **Labels**. Submit is disabled until a project and a summary are present.
- On submit Nectus runs `acli jira workitem create --project <key> --type <type>
  --summary "<summary>" --json` plus `--description/--assignee/--label` when provided,
  reads the new key from the JSON (falling back to a `KEY-123` token in the output),
  then `view`s it to return a fully populated card. The board refreshes and the new
  item's **view panel** auto-opens, where the launch row can start an agent on it.
- Type is **optimistic**: `acli` cannot enumerate a project's configured issue types,
  so an invalid type for the chosen project surfaces as an `acli` error (same model as
  drag-to-transition). `acli workitem create` has no priority flag, so priority is not
  set at create time.

## Managing work items

All JIRA mutations are explicit actions; nothing is written to JIRA implicitly.

- **Transition:** drag a card to another column, or change the status in the work
  item dialog. Runs `acli jira workitem transition --key <key> --status "<status>"
  --yes`. The move is **optimistic** — `acli` exposes no list of valid transitions,
  so if JIRA's workflow forbids the move the card reverts and the error is shown.
- **Assign:** `acli jira workitem assign --key <key> --assignee <user>`.
- **Comment:** `acli jira workitem comment --key <key> --body "<text>"`.
- **View:** `acli jira workitem view <key> --json` backfills a story description when
  creating a task from it. JIRA Cloud's v3 API returns `description` as an Atlassian
  Document Format (ADF) object, not a string; `native/src/jira.rs` flattens that node
  tree to plain text (paragraphs/headings/list items separated by newlines) and still
  accepts a plain-string or `null` description.
- **Open in JIRA:** the work-item dialog and the linked-story panel open the canonical
  browse URL `https://<site>/browse/<KEY>`, built from the connected site host plus the
  issue key (`jiraBrowseUrl` in `src/lib/jira.ts`). `acli` only returns the issue's REST
  `self` link (`…/rest/api/3/issue/<id>`), which is an API endpoint, not a page — it is
  intentionally ignored, and the linked-story panel rebuilds the URL so stories attached
  before this was fixed still open correctly.

## Attaching a task to a story

- From a card (or its dialog) choose **Create task from this story**. The task modal
  opens pre-seeded: title from the story summary, prompt from its description, with a
  project selector for the destination repo (the board is global, so the repo is
  chosen at attach time).
- The link is **local only** — attaching writes nothing back to JIRA. The story key,
  summary, and URL are stored on the task (`jira_issue_key/summary/url`).
- The linked story shows as a badge on task cards and rows, and as a detachable panel
  in the task inspector. Detaching clears the local link (and again writes nothing to
  JIRA).
- The reverse is also surfaced: each board card lists the local tasks attached to that
  story under a **Tasks** section — agent logo, title, and status (a live session shows
  a pulsing **Running** indicator). Clicking a task chip opens it in the dashboard.
  Matching is by `task.jira_issue_key === item.key`; a story with no attached tasks
  shows no section.

## Requirements

- The Atlassian CLI (`acli`) must be installed and authenticated
  (`acli jira auth login`).
- A project must be chosen from the picker in the JIRA view header to load work
  items. No JQL is required.

## Caveats

- **Without** a connected REST token, `acli` has no command to enumerate a project's
  statuses or a work item's valid transitions. Consequences: empty-status columns do
  not appear, and drag-to-transition is optimistic (validated only by `acli`'s exit
  status). Connecting an API token (see *Optional REST layer*) resolves both.
- With a REST token, the actual transition is resolved by matching the chosen status
  **name** to a legal transition; a workflow with two transitions to the same target
  status name resolves to the first.
- The `--json` field shape is parsed tolerantly in `native/src/jira.rs` (top-level
  array or wrapped object; flat or `fields`-nested; every field optional; `description`
  accepted as an ADF object, plain string, or `null`). A drifting shape drops a single
  bad item rather than failing the whole board.

## Key files

- Board view: `src/components/JiraBoardPage.tsx`
- Work item management dialog: `src/components/JiraWorkItemDialog.tsx`
- New-work-item create panel: `src/components/JiraCreateWorkItemPanel.tsx`
- Linked-story inspector panel: `src/components/JiraPanel.tsx`
- Board + connection state, project list, auto-derived columns, optimistic
  transition, and work-item creation: `src/hooks/useJira.ts`
- Create-from-story, create-work-item handlers, and board-config persistence:
  `src/hooks/useApp.ts`
- Frontend API: `src/api.ts`
- `acli` shell-out, JSON parsing, the JQL builder (`build_board_jql`, incl. the
  `status in (...)` filter clause), and the create argument builder/key parser:
  `native/src/jira.rs`
- Optional REST layer: client + fixture-tested parsers (`parse_transitions`,
  `parse_project_statuses`) in `native/src/jira_rest.rs`; Keychain token store in
  `native/src/jira_secret.rs`; the token/transitions/statuses commands and the
  REST-aware `jira_transition_work_item` in `native/src/lib.rs`. Settings token card:
  `src/components/settings/JiraConnectionCard.tsx`.
- Parser regression guard: scrubbed real `acli --json` output in
  `native/src/jira_fixtures/` (view/search/project list), `include_str!`ed by the
  `real_acli_*` tests in `native/src/jira.rs`. These pin the live CLI shape (e.g.
  ADF `description`) so a struct/CLI drift fails a test instead of users. Refresh
  via `native/src/jira_fixtures/scrub.py` per that directory's `README.md`.
- Backend commands: `jira_status`, `jira_list_projects`, `jira_search_board`,
  `jira_get_work_item`, `jira_transition_work_item`, `jira_assign_work_item`,
  `jira_comment_work_item`, `jira_create_work_item`, `set_task_jira_link`
  (registered in `native/src/lib.rs`)
- Link persistence: `jira_issue_key/summary/url` columns on the `tasks` table; board
  config in `jira_board_project` and the `jira_filter_*` flags on `app_settings`
