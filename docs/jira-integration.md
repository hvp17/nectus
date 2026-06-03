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

## Managing work items

All JIRA mutations are explicit actions; nothing is written to JIRA implicitly.

- **Transition:** drag a card to another column, or change the status in the work
  item dialog. Runs `acli jira workitem transition --key <key> --status "<status>"
  --yes`. The move is **optimistic** — `acli` exposes no list of valid transitions,
  so if JIRA's workflow forbids the move the card reverts and the error is shown.
- **Assign:** `acli jira workitem assign --key <key> --assignee <user>`.
- **Comment:** `acli jira workitem comment --key <key> --body "<text>"`.
- **View:** `acli jira workitem view <key> --json` backfills a story description when
  creating a task from it.

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

## Requirements

- The Atlassian CLI (`acli`) must be installed and authenticated
  (`acli jira auth login`).
- A project must be chosen from the picker in the JIRA view header to load work
  items. No JQL is required.

## Caveats

- `acli` has no command to enumerate a project's statuses or a work item's valid
  transitions. Consequences: empty-status columns do not appear, and drag-to-transition
  is optimistic (validated only by `acli`'s exit status).
- The `--json` field shape is parsed tolerantly in `native/src/jira.rs` (top-level
  array or wrapped object; flat or `fields`-nested; every field optional). A drifting
  shape drops a single bad item rather than failing the whole board.

## Key files

- Board view: `src/components/JiraBoardPage.tsx`
- Work item management dialog: `src/components/JiraWorkItemDialog.tsx`
- Linked-story inspector panel: `src/components/JiraPanel.tsx`
- Board + connection state, project list, auto-derived columns, optimistic
  transition: `src/hooks/useJira.ts`
- Create-from-story and board-config persistence: `src/hooks/useApp.ts`
- Frontend API: `src/api.ts`
- `acli` shell-out, JSON parsing, and JQL builder (`build_board_jql`):
  `native/src/jira.rs`
- Backend commands: `jira_status`, `jira_list_projects`, `jira_search_board`,
  `jira_get_work_item`, `jira_transition_work_item`, `jira_assign_work_item`,
  `jira_comment_work_item`, `set_task_jira_link` (registered in `native/src/lib.rs`)
- Link persistence: `jira_issue_key/summary/url` columns on the `tasks` table; board
  config in `jira_board_project` and the `jira_filter_*` flags on `app_settings`
