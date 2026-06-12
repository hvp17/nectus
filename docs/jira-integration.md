# JIRA Integration

Nectus connects to JIRA Cloud with a user-pasted Atlassian **API token**
(Settings → JIRA) and talks to the JIRA Cloud REST API directly. The token is the
only connection — there is no CLI dependency, no OAuth flow, and the token never
touches SQLite.

## Connection

- **Connect:** Settings → **JIRA** → *JIRA API token*: enter the site host +
  Atlassian account email and paste a token. The **Create a token** button
  deep-links to `id.atlassian.com/manage-profile/security/api-tokens`;
  **Test & connect** verifies the token against `GET /rest/api/3/myself`
  (Basic auth, `email:token`) before anything is saved.
- **Storage:** the token is stored in the **macOS Keychain** (service =
  `com.hvp17.nectus`, account = `jira-api-token:{site}`), never in SQLite. Only the
  non-secret site/email are persisted (`app_settings.jira_site_url`,
  `app_settings.jira_rest_email`). Disconnecting deletes the Keychain entry and
  clears the email. This is a deliberate, contained exception to the "no
  app-managed tokens" default — an opt-in, user-revocable token, not OAuth.
- On opening the JIRA view the app reads the connection state
  (`jira_rest_status`: a Keychain token exists for the configured site + an email
  is set). The board header shows a single badge (the connected site, or
  "Not connected"); without a connection the board body points to Settings → JIRA.
- A single Atlassian site is supported (whatever the token card points at).

## REST endpoints used

All commands run over the JIRA Cloud v3 core API (plus the Agile API for Sprint
view), via `jira_rest_call` in `native/src/lib.rs` → `native/src/jira_rest.rs`:

- Project list: `GET /project/search`
- Board + epic search: `POST /search/jql` (the endpoint that replaced the removed
  `/rest/api/3/search`), paginated via `nextPageToken` up to 200 items
- Work-item view: `GET /issue/{key}` (description included, ADF flattened)
- Legal transitions: `GET /issue/{key}/transitions`; transition execution:
  `POST /issue/{key}/transitions` (the chosen status name resolved to a
  transition id)
- Assign: `PUT /issue/{key}/assignee`, with `@me`/email/display name resolved to
  an account id via `GET /myself` / `GET /user/search`
- Comment: `POST /issue/{key}/comment`; create: `POST /issue` — plain text is
  wrapped in a minimal ADF document (one paragraph per line) by `text_to_adf`,
  the inverse of the read-side ADF flattener
- Project status set: `GET /project/{key}/statuses` (unioned across issue types —
  powers empty columns and the status filter)
- Sprint view: the Agile API under `/rest/agile/1.0` (see *Sprint view*)

## The board (no JQL to write)

The board is entirely UI-driven; no JQL is ever typed.

- The board is global — it is not tied to a repo. In the header you **pick a JIRA
  project** from a dropdown and toggle a few filters: **My issues**
  (`assignee = currentUser()`), **Hide done** (`statusCategory != Done`, on by
  default), and **Current sprint** (`sprint in openSprints()`).
- **Epic filter** — an **Epic** dropdown in the header narrows the board to a single
  epic's children. Its options are the project's epics, loaded with the JQL
  `project = "<key>" AND issuetype = Epic ORDER BY summary ASC` (the
  `jira_list_epics` command); selecting one compiles into the board JQL as
  `parent = "<EPIC-KEY>"` (JIRA Cloud's unified `parent` field covers the
  epic→story link in both team- and company-managed projects). "All epics" clears
  it, and switching projects resets it (an epic key belongs to one project). The
  selection persists in `app_settings.jira_filter_epic`.
- Nectus builds the JQL from that structured config in `jira::build_board_jql`
  (e.g. `project = "PROJ" AND statusCategory != Done ORDER BY updated DESC`). The
  config is stored as `app_settings.jira_board_project` plus the three
  `jira_filter_*` flags; the generated query is never shown to the user.
- **Columns** render the project's full workflow status set (empty statuses
  included), ordered by JIRA status category (To Do → In Progress → Done) then
  status name, narrowed by the **status filter** (a multi-select in the board
  header, compiled into the JQL as `status in (...)`). While the status set is
  still loading, columns are derived from the statuses present in the results.
- The board refreshes when the view becomes active, when the project/filters change,
  when create/transition/assign/comment actions succeed, and via the `Refresh`
  button. There is no background polling or webhook.

## Sprint view (grouped by epic)

The JIRA view has a **Board / Sprint** toggle in its header (sharing the project
picker). Sprint view renders JIRA's sprint/backlog layout: each **active** then
**future** sprint as a section, followed by the **Backlog**, with every section split
into **epic swimlanes**.

- **Data.** The Agile API (`/rest/agile/1.0`): the project's first **Scrum** board
  (`/board?projectKeyOrId=<key>&type=scrum`) → its active+future sprints
  (`/board/{id}/sprint?state=active,future`) → each sprint's issues
  (`/board/{id}/sprint/{id}/issue`) and the `/board/{id}/backlog`. A project with
  no Scrum board reports that Sprint view needs one.
- **Epic grouping.** Each issue carries its epic (the Agile `epic` field, or `parent`
  when the parent is an Epic — covering team- and company-managed projects), and
  `groupByEpic` (`src/lib/jiraSprints.ts`) buckets a lane's issues into swimlanes,
  first-seen epic order with a trailing "No epic" group.
- **Read-only (v1).** Cards open the work-item panel, create a task from a story, and
  open in JIRA, and each shows a status pill (there are no status columns). There is no
  drag-to-transition and no moving issues between sprints in this view; use Board view
  to transition. The Agile board is fetched fresh on open, on project change, and via
  Refresh — no background polling.

## Creating a work item

- The board toolbar has a **New work item** button (enabled once connected and a
  project is chosen). It opens an **inline create form** in the same right-hand
  dock slot the work-item view panel uses — the two are mutually exclusive, so opening
  one closes the other (no modal, matching the rest of the JIRA surfaces).
- Fields: **Project** (defaults to the board's project; any visible project can be
  picked), **Type** (`Task`/`Bug`/`Story`/`Epic`), **Summary** (required), and optional
  **Description**, **Assignee** (email/account id, or `@me`), and comma-separated
  **Labels**. Submit is disabled until a project and a summary are present.
- On submit Nectus runs `POST /rest/api/3/issue` (the description wrapped in a
  minimal ADF document, the assignee resolved to an account id), then `view`s the
  new key to return a fully populated card. The board refreshes and the new item's
  **view panel** auto-opens, where the launch row can start an agent on it.
- Type is **optimistic**: Nectus does not enumerate a project's configured issue
  types, so an invalid type for the chosen project surfaces as a JIRA error (same
  model as drag-to-transition). Priority is not set at create time.

## Managing work items

All JIRA mutations are explicit actions; nothing is written to JIRA implicitly.

- **Transition:** drag a card to another column, or change the status in the work
  item dialog (the dropdown shows the issue's **legal transitions**, fetched on
  open). The status name is resolved to a legal transition and POSTed; a
  workflow-forbidden move errors, the card reverts, and the error is shown.
- **Assign:** `PUT /issue/{key}/assignee` after resolving `@me` (via `/myself`),
  an email, or a display name to an account id via `/user/search` (exact email
  match wins, then exact display name, then a single unambiguous result; app/bot
  accounts are ignored).
- **Comment:** `POST /issue/{key}/comment` with the text wrapped in a minimal ADF
  document (one paragraph per line).
- **View:** `GET /issue/{key}` backfills a story description when creating a task
  from it. JIRA Cloud's v3 API returns `description` as an Atlassian Document
  Format (ADF) object, not a string; `native/src/jira.rs` flattens that node tree
  to plain text (paragraphs/headings/list items separated by newlines) and still
  accepts a plain-string or `null` description.
- **Open in JIRA:** the work-item dialog and the linked-story panel open the canonical
  browse URL `https://<site>/browse/<KEY>`, built from the connected site host plus the
  issue key (`jiraBrowseUrl` in `src/lib/jira.ts`). The API's `self` link
  (`…/rest/api/3/issue/<id>`) is an endpoint, not a page — it is intentionally
  ignored, and the linked-story panel rebuilds the URL so stories attached before
  this was fixed still open correctly.

## Attaching a task to a story

- From a card (or its dialog) choose **Create task from this story**. The task modal
  opens pre-seeded: title from the story summary, prompt from its description, with a
  project selector for the destination repo (the board is global, so the repo is
  chosen at attach time). The composer opens in Project mode, but the link is
  preserved if you switch to Workspace (cross-repo) scope: the cross-repo create
  takes no JIRA fields, so the story is attached in a follow-up `set_task_jira_link`
  call — a workspace task keeps its story link just like a single-repo one.
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

- A JIRA Cloud **API token** connected in Settings → JIRA (site host + account
  email + token). Nothing else needs to be installed.
- A project must be chosen from the picker in the JIRA view header to load work
  items. No JQL is required.

## Caveats

- API tokens are **JIRA Cloud only** (Basic auth `email:token`), and Atlassian
  tokens have a mandatory expiry — a 401 after months of use usually means the token
  expired; create a new one and **Update token** in Settings.
- **Keychain storage requires keyring's `apple-native` feature** (set in
  `native/Cargo.toml`). Without it, keyring 3 silently falls back to an
  in-memory mock store — the token appears to save but is gone after an app
  relaunch. If a macOS dialog ever asks whether Nectus may access the item
  (e.g. after an app update changes the ad-hoc code signature), choose Allow.
- **TLS trust comes from the macOS system trust store** (`ureq` is built with the
  `native-certs` feature), so corporate TLS-inspection proxies (Zscaler, Netskope,
  …) whose root CA is installed in the Keychain work. A
  `tls connection init failed: invalid peer certificate: UnknownIssuer` on
  **Test & connect** means the intercepting proxy's root CA is not trusted by the
  system — install/trust it in Keychain Access, then retry.
- A transition is resolved by matching the chosen status **name** to a legal
  transition; a workflow with two transitions to the same target status name
  resolves to the first.
- Assignment needs an account id; a query matching several non-bot users (and
  none exactly by email or display name) is rejected as ambiguous — use the full
  email address.
- The work-item JSON shape is parsed tolerantly in `native/src/jira.rs` (top-level
  array or wrapped object — the `issues`/`values` envelopes; flat or
  `fields`-nested; every field optional; `description` accepted as an ADF object,
  plain string, or `null`). A drifting shape drops a single bad item rather than
  failing the whole board. The same parser serves `/search/jql` pages, issue
  views, and Agile-API payloads.

## Key files

- Board view (incl. the Board/Sprint toggle): `src/components/JiraBoardPage.tsx`
- Sprint view body (sprint sections + epic swimlanes): `src/components/JiraSprintBody.tsx`;
  epic-grouping helper: `src/lib/jiraSprints.ts`
- Work item management dialog: `src/components/JiraWorkItemDialog.tsx`
- New-work-item create panel: `src/components/JiraCreateWorkItemPanel.tsx`
- Linked-story inspector panel: `src/components/JiraPanel.tsx`
- Board + connection state, project list, columns, optimistic
  transition, and work-item creation: `src/hooks/useJira.ts`
- Create-from-story / create-task handlers: `src/hooks/useComposer.ts`
  (`createTaskFromStory`, `createTask`); board-config persistence: `src/hooks/useJira.ts`
- Frontend API: `src/api.ts`
- Shared JIRA domain helpers — the tolerant payload parsers and the JQL builders
  (`build_board_jql`, incl. the `status in (...)` and `parent = "<epic>"` filter
  clauses; `build_epics_jql`): `native/src/jira.rs`
- REST client: fixture-tested parsers (`parse_transitions`,
  `parse_project_statuses`), the core-API operations (`list_projects`, the
  paginated `search`, `view`, `assign` + account-id resolution, the ADF-building
  `comment`/`create`), plus the Agile-API sprint layer (`find_scrum_board`,
  `parse_sprints`, `sprint_board`) in `native/src/jira_rest.rs`; Keychain token
  store in `native/src/jira_secret.rs`; the `jira_rest_call` command plumbing in
  `native/src/lib.rs`. Settings token card:
  `src/components/settings/JiraConnectionCard.tsx`.
- Parser regression guard: scrubbed real JIRA Cloud v3 payloads in
  `native/src/jira_fixtures/` (view/search/project list), `include_str!`ed by the
  fixture tests in `native/src/jira.rs`. These pin the live API shape (e.g.
  ADF `description`) so a struct/API drift fails a test instead of users. Refresh
  via `native/src/jira_fixtures/scrub.py` per that directory's `README.md`.
- Backend commands: `jira_rest_status`, `set_jira_api_token`,
  `clear_jira_api_token`, `jira_list_projects`, `jira_search_board`,
  `jira_list_epics`, `jira_sprint_board`, `jira_get_work_item`,
  `jira_list_transitions`, `jira_project_statuses`, `jira_transition_work_item`,
  `jira_assign_work_item`, `jira_comment_work_item`, `jira_create_work_item`,
  `set_task_jira_link` (registered in `native/src/lib.rs`)
- Link persistence: the `jira_issue_key`, `jira_issue_summary`, and `jira_issue_url`
  columns on the `tasks` table; board config in `jira_board_project`, the
  `jira_filter_*` flags, and `jira_filter_epic` on `app_settings`
