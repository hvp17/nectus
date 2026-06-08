# Tracking And Debugging

This guide documents where Nectus Desktop tracks state, which events move that
state, and where to look when behavior is wrong. It is the authoritative
reference for the SQLite tables, the Tauri command and event catalog, the
task/session fields, reviewer-session-resume, and the debugging flows.

For the connected layer model and the "where does X live?" table, see
[architecture.md](architecture.md); for the per-file maps, see
[../AGENTS.md](../AGENTS.md).

## State Sources

### SQLite

The desktop app opens a local SQLite database named `nectus.sqlite3` inside the
Tauri app data directory. The app logs the resolved app data directory during
startup.

Core tables:

| Table | Purpose |
| --- | --- |
| `repos` | Saved project repositories and each project's default worktree root. |
| `workspaces` | Durable, named groups of repos (VSCode-workspace style). |
| `workspace_repos` | Workspace membership: `(workspace_id, repo_id, position)`. Many-to-many, so a repo can belong to several workspaces; cascade-deletes with either side. |
| `agent_profiles` | CLI agent configuration, including command, model, args, and env. |
| `app_settings` | Default agent, worktree pattern, branch prefix, theme, density, and the JIRA board config (selected project + filter flags + `jira_filter_statuses`; the JQL is built from these). Also the non-secret JIRA REST account email (`jira_rest_email`); the REST API token itself lives in the macOS Keychain, never here. |
| `tasks` | Primary work item, status, prompt, optional worktree, active session, saved session, the persisted `attention` signal (`needs_input`/NULL), optional JIRA story link, and optional `workspace_id` (the workspace a cross-repo task was created in). For a cross-repo task the `repo_id`/`branch_name`/`worktree_path`/`pr_url` columns describe the **primary** repo. |
| `task_repos` | Per-repo working state for a task (Increment B): `(task_id, repo_id, branch_name, worktree_path, pr_url, position)`. The complete repo set; a single-repo task has one row mirroring `tasks`. Unique on `worktree_path` and on `(repo_id, branch_name)`. Cascade-deletes with the task or repo. |
| `review_loops` | Current review configuration and status per task. Includes `reviewer_session_id` (the active reviewer's session id for resume; reset to `NULL` when the loop is restarted via `start_pair_loop`). |
| `review_runs` | Reviewer prompts, outputs, verdicts, and errors by review attempt. |
| `pr_reviews` | External pull-request reviews: PR metadata, status, `verdict` (`passed`/`blockers`/`inconclusive`, set when a review reaches `ready`), Markdown output, ephemeral worktree path, and the consensus columns `mode` (`single`/`consensus`), `max_rounds`, `rounds_completed`, `converged`. Includes `reviewer_session_id` (preserved across reruns of the same PR review; cleared only when a new review is created). For consensus, `reviewer_profile_id` is the synthesizer. |
| `pr_review_reviewers` | Consensus participants: the reviewer profiles taking part in a consensus PR review, in selection order. Cascade-deletes with the review. |
| `pr_review_runs` | Consensus per-reviewer, per-round outputs: `round`, `verdict`, Markdown `output`, and `error`. One row per reviewer per round. Cascade-deletes with the review. |

Schema owner: `native/src/db/schema.rs`

Row mapping and enum parsing: `native/src/db/rows.rs`

Persistence APIs:

- `native/src/db/mod.rs`: database setup plus project, settings, task, and
  session-state records.
- `native/src/db/workspaces.rs`: workspace CRUD with transactional membership
  (`workspace_repos`) replacement.
- `native/src/db/agent_profiles.rs`: agent profile queries and upserts.
- `native/src/db/review_loops.rs`: review-loop and review-run records.
- `native/src/db/pr_reviews.rs`: PR-review records and `owner/repo` → project
  resolution.

### Frontend State

Frontend state lives in three layers, not a single god-hook (the old
`src/hooks/useApp.ts` was deleted). See [architecture.md](architecture.md)
("State ownership") for the full picture; the short version:

- **Server state — TanStack Query (`src/queries/`).** Every saved
  project/task/profile/settings/review-loop/PR-review/diff read goes through a
  Query hook backed by the cache (no `useState` loading boilerplate). SQLite
  through the Tauri commands remains the source of truth.
- **UI/runtime state — Zustand store (`src/store/appStore.ts`).** Composed from
  concern-split slices (`navigation`, `selection`, `composer`, `runtime`,
  `sessionRuntime`, `notification`). Owns what is *not* server state: current
  view / focused workspace, repo/task/agent selection, the New Task composer
  draft (the `composer` slice — not a form hook), the push-driven `liveLines` /
  `taskAttention` maps, `deletingTaskIds`, and toasts/messages.
- **Events — one mount-once bridge (`src/hooks/useEventBridge.ts`).** Mounted in
  `AppLayout`, it owns every Rust session/review/PR subscription and routes each
  event to the Query cache or the Zustand store. Because events are centralized,
  the domain hooks are pure cache consumers callable per component.

Review status is included in task summaries so the board can label cards before
a task is opened; review is modeled as a single pass.

### Codex JSONL

For Codex sessions, Nectus watches persisted rollout JSONL under:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

The watcher:

- Finds the latest file whose `session_meta.payload.cwd` matches the task cwd
  and whose timestamp is after the Nectus session start.
- Keeps looking for matching Codex metadata while the Nectus task session remains
  active. It polls every 500 ms for the first 120 attempts, then backs off to
  every 5 seconds for blank or idle Codex sessions that have not written JSONL
  metadata yet.
- Skips matching metadata when the rollout is a Codex subagent, auto-review, or
  guardian session.
- Reads appended lines every 500 ms.
- Emits `session_idle` for `event_msg.payload.type == "task_complete"` or
  `event_msg.payload.type == "turn_complete"`.
- Attempts to emit `session_needs_input` for explicit approval, permission,
  user-input, elicitation, patch-approval, confirmation, or needs-input event
  names in `event_msg` entries.
- Emits `session_needs_input` for persisted `response_item` function calls where
  `payload.name == "request_user_input"`. The watcher extracts
  `questions[].question` from the function-call `arguments` string when
  available and sends it as the prompt preview.

The JSONL protocol details and caveats are in
[codex-session-jsonl.md](codex-session-jsonl.md).

Important limitation: several approval and input request `event_msg` variants
are defined by Codex but are not persisted by default in the checked rollout
policy. Treat `session_idle` as high confidence. Treat input-needed detection as
best effort across Codex versions and launch modes.

### OpenCode Local Server

For OpenCode sessions, Nectus reserves a localhost port and launches the CLI with
`opencode --hostname 127.0.0.1 --port <port>`.

The watcher:

- Sends new task prompts with `--prompt <task prompt>` and skips the generic
  post-spawn PTY prompt write, so OpenCode does not receive the prompt twice.
- Discovers the matching top-level OpenCode session from `GET /session` (skipping
  subagent sessions, which carry a `parentID`) and saves the id and label in
  `tasks.last_session_id` / `tasks.last_session_label` when available.
- Subscribes to the server's `GET /event` SSE stream and translates native
  OpenCode events into Nectus signals: `session.idle` maps to `session_idle`;
  `permission.asked`, `permission.v2.asked`, `question.asked`, and
  `question.v2.asked` map to `session_needs_input`. Events for other sessions
  (e.g. subagents) are ignored. The stream is re-established while the session is
  alive and ends when the OpenCode process exits.

OpenCode authentication stays owned by OpenCode (`opencode auth login` or TUI
`/connect`). Nectus stores only the profile command, model, args, env, and saved
session id.

## Tauri Commands

Frontend wrapper: `src/api.ts`

Backend registration: `native/src/lib.rs`

Current commands:

| Command | Purpose |
| --- | --- |
| `add_repo` | Validate and save a local git project. |
| `list_repos` | Load saved projects. |
| `get_app_settings` | Load global settings. |
| `update_app_settings` | Save settings and refresh project worktree roots. |
| `create_task` | Create a direct-edit task or create a git worktree-backed task (single repo). |
| `create_cross_repo_task` | Create a task spanning ≥2 repos (Increment B): one worktree per repo as siblings under a shared parent, a single agent rooted in the primary repo's worktree, and a `task_repos` row per repo. Rolls back created worktrees on failure. |
| `list_tasks` | Load task summaries (each with its `taskRepos`) and per-repo dirty-state checks. |
| `update_task_metadata` | Update title, status, or PR URL. |
| `delete_task` | Delete a task and remove its worktree when applicable. Takes a `force` flag: without it a worktree with uncommitted changes is preserved and an error is returned; with it (after the delete dialog's warning) the worktree is force-removed. |
| `list_workspaces` | Load workspaces, each with its ordered member `repoIds`. |
| `create_workspace` | Create a named workspace from `name` + `repoIds` (membership written transactionally; duplicate ids dropped). |
| `update_workspace` | Rename a workspace and replace its membership/order. |
| `delete_workspace` | Delete a workspace (membership cascade-deletes). |
| `task_diff_summary` | List the files a task changed: a worktree task's branch vs the locally-resolved base (`origin/HEAD` merge-base, committed + uncommitted), or a direct-edit task's working tree vs `HEAD`. Returns the base label plus per-file change kind and `+/-` counts. |
| `task_diff_file` | Return the unified patch for one file in a task's diff (lazy-loaded per file; untracked files diff against `/dev/null`). |
| `github_status` | Report whether `gh` is installed, authenticated, and the active account. |
| `github_pull_request_status` | Fetch live PR state, CI check rollup, and review decision via `gh pr view --json`. |
| `detect_github_pull_request` | Check whether a worktree task's branch already has a PR (`gh pr view`) and backfill its URL. |
| `jira_status` | Report whether `acli` is installed, authenticated, and the active site. |
| `jira_list_projects` | List visible JIRA projects for the board's project picker (`acli jira project list --json`). |
| `jira_search_board` | Load board work items; the JQL is built from the structured board config (project + filter flags), so no JQL is typed. |
| `jira_get_work_item` | Fetch a single work item (e.g. to backfill a story description). |
| `jira_transition_work_item` | Transition a work item to a target status. REST-aware: with a connected token it resolves the status to a legal transition and POSTs it; otherwise falls back to optimistic `acli` transition. |
| `jira_assign_work_item` | Assign a work item to a user. |
| `jira_comment_work_item` | Add a comment to a work item. |
| `jira_rest_status` | Report whether the optional JIRA REST API token is connected (Keychain token present for the configured site + email). |
| `set_jira_api_token` | Verify a token via `GET /myself`, then store it in the macOS Keychain and persist the non-secret site/email. Stores nothing on failure. |
| `clear_jira_api_token` | Disconnect: delete the Keychain token and clear the stored REST email. |
| `jira_list_transitions` | List an issue's legal transitions via REST (`GET /issue/{key}/transitions`). Requires a connected token. |
| `jira_project_statuses` | Load a project's full workflow status set via REST (`GET /project/{key}/statuses`), unioned across issue types. Requires a connected token. |
| `set_task_jira_link` | Set or clear the local JIRA story link on a task (never writes to JIRA). |
| `list_agent_profiles` | Load agent profiles. |
| `upsert_agent_profile` | Create or update an agent profile. |
| `start_pair_loop` | Enable reviewer automation for a task. |
| `run_pair_review` | Trigger an immediate reviewer pass for a task with a running worker session. |
| `stop_pair_loop` | Stop reviewer automation for a task. |
| `get_task_review_loop` | Load a task's current review loop. |
| `list_task_review_runs` | Load stored reviewer runs for a task. |
| `create_pr_review` | Resolve a PR URL to a known project, queue a review, and start the background reviewer. Takes `reviewer_profile_ids` + `max_rounds`: one reviewer runs a single review, two or more run a consensus review. |
| `list_pr_reviews` | Load all PR reviews, newest first. |
| `get_pr_review` | Load a single PR review by id. |
| `list_pr_review_runs` | Load a consensus review's per-reviewer, per-round outputs (empty for single reviews). |
| `rerun_pr_review` | Reset a PR review to queued and re-run it against the latest PR head (same single/consensus mode; clears prior rounds). |
| `delete_pr_review` | Remove a PR review and any lingering ephemeral worktree. |
| `start_session` | Start an agent in the task cwd. |
| `resume_session` | Resume a Codex, Claude, or OpenCode saved session. |
| `stop_session` | Stop a running PTY child process. |
| `resize_session` | Resize the PTY. |
| `send_session_input` | Write keyboard input or terminal-dropped file paths into the PTY without appending an Enter sequence. |
| `submit_session_input` | Submit an app-authored prompt into the PTY, flush it, then send a separate terminal Enter sequence shared with review feedback. The task workflow `Create PR` action uses this command to ask the running agent to open a pull request; Nectus does not call GitHub or store GitHub credentials for that flow. |
| `session_output_snapshot` | Load buffered terminal output for a running session. |

## Events

Backend-to-frontend events:

| Event | Payload | Source |
| --- | --- | --- |
| `session_output` | PTY output chunk and stream offset. | `native/src/sessions/mod.rs` |
| `session_activity` | Task id, session id, and the agent's latest human-readable activity line (throttled and de-duplicated). Parsed from each provider's structured event stream — Codex `agent_reasoning`/`agent_message`, Claude `PreToolUse` hook, OpenCode `message.part.updated` — so it reads as real progress ("Editing App.tsx", "Running npm test") rather than TUI chrome. Gemini and custom agents fall back to an ANSI-stripped tail of the PTY output. | `native/src/sessions/mod.rs` (`emit_activity_line`), driven by `codex.rs`, `claude.rs`, `opencode.rs` |
| `session_exited` | Session id and optional exit code. | `native/src/sessions/mod.rs`, `native/src/lib.rs` |
| `session_idle` | Task id, session id, turn id, optional message. | `native/src/sessions/mod.rs` (`emit_session_signal`), driven by `codex.rs` (JSONL), `claude.rs` (hooks), and `opencode.rs` (local server `/event` `session.idle`) |
| `session_needs_input` | Task id, session id, reason, optional prompt. | `native/src/sessions/mod.rs` (`emit_session_signal`), driven by `codex.rs` (JSONL), `claude.rs` (hooks), and `opencode.rs` (local server `/event` permission/question asks) |
| `review_loop_updated` | Review-loop state and optional review run. | `native/src/sessions/review_loop.rs` |
| `review_output` | Task id, a chunk of the task reviewer's live stdout, and the chunk's byte offset (a `0` offset starts a new run). Streamed only by the task review loop, not by PR reviews. | `native/src/sessions/review_loop.rs` |
| `pr_review_updated` | Updated external PR review (status, verdict, metadata, Markdown output), plus an optional `latest_run` carrying the consensus round output that triggered the update. | `native/src/sessions/pr_review.rs`, `native/src/sessions/pr_consensus.rs` |

Frontend event listeners:

- `src/hooks/useEventBridge.ts` is the single, mount-once bridge (mounted in
  `AppLayout`). It owns every session/review/PR subscription
  (`session_activity` / `session_idle` / `session_needs_input` /
  `session_exited`, `review_loop_updated`, `pr_review_updated`) and routes each
  event to the Query cache (tasks, review loop/runs, PR reviews) or the Zustand
  store (`liveLines` / `taskAttention`, toasts/notifications). It records
  `session_activity` into a per-task `liveLines` map (cleared on
  `session_exited`) that drives the live "what it's doing" line on task cards and
  Mission Control rows, and resolves `session_exited` to its task via the active
  session id (the payload carries no task id).
- The remaining per-component listeners are intentionally NOT in the bridge:
  - `src/TerminalPane.tsx` listens for `session_output`, `session_exited`, and
    Tauri v2 `getCurrentWebview().onDragDropEvent()` file-path drops for the
    active terminal.
  - `src/hooks/useTaskReviewLoop.ts` listens for the per-component live
    `review_output` stream, accumulating the live reviewer stdout for the
    selected task into the read-only Review pane
    (`src/components/ReviewTerminalPane.tsx`).
  - `src/hooks/useTaskDiff.ts` keeps its own (mounted-once) `session_idle`
    listener to refresh the diff.
- `native/tauri.conf.json` keeps `dragDropEnabled` enabled on the main window so
  Tauri emits native file-drop events instead of relying on browser-only drops.

## Task Tracking Fields

Important `tasks` columns:

- `status`: `planned`, `in_progress`, `review`, or `done`.
- `prompt`: optional task instructions sent to a new session.
- `agent_profile_id`: preferred agent profile for the task.
- `has_worktree`: whether the task owns a git worktree.
- `branch_name`: set only when `has_worktree = 1`; blank worktree creation
  generates a `task-...` branch name.
- `worktree_path`: set only when `has_worktree = 1`.
- `active_session_id`: running session lock. Cleared on app startup, session
  stop, natural exit, and app close.
- `attention`: backend-owned attention signal — `needs_input` when the agent is
  blocked on the user, else `NULL`. Set when the watcher emits
  `session_needs_input`, cleared on session start / idle / exit (folded into the
  same `UPDATE` as `active_session_id`). Persisted so the "needs you" signal
  survives an app reload; the frontend reads it back off the task
  (`deriveAgentState`), while the live in-session prompt/reason detail still rides
  the push-driven `taskAttention` store slice.
- `last_session_id`: saved session id used for resume when supported.
- `last_session_agent`: command or agent kind used for the last session.
- `last_session_cwd`: project path or worktree path used for the last session.
- `last_session_label`: Codex or OpenCode label from the latest matching provider
  metadata when available.
- `jira_issue_key` / `jira_issue_summary` / `jira_issue_url`: optional local-only
  link to a JIRA story, captured at attach time; null when the task is unlinked.
  Set/cleared via `set_task_jira_link`; never written back to JIRA.

The schema enforces that direct-edit tasks have no branch/worktree path and
worktree tasks have both.

Additive columns (such as the `jira_*` task fields above and the `app_settings` JIRA
board config — `jira_board_project`, `jira_filter_my_issues`, `jira_filter_unresolved`,
`jira_filter_current_sprint`, the REST `jira_rest_email`, the JSON-encoded
`jira_filter_statuses` status filter, plus the legacy `jira_board_jql` /
`jira_site_url`) are introduced by `run_migrations` in `native/src/db/schema.rs`, which
`ALTER TABLE`s any missing column on every open so existing databases upgrade in place.
The JIRA REST API token is **not** a column — it lives in the macOS Keychain
(`native/src/jira_secret.rs`).

`run_migrations` also runs `migrate_legacy_worktree_pattern`: a one-time data
migration that moves databases still on the legacy worktree default
(`../{repoName}-worktrees`) onto the current `~/.nectus/worktrees/{repoName}`
default and recomputes every repo's stored `default_worktree_root` from it (the
same `refresh_repo_worktree_roots` path a Settings change uses). It is
self-guarding — once rewritten the pattern no longer matches the legacy value,
and a customized pattern is left untouched.

## Reviewer Session Resume

Claude, Codex, and OpenCode reviewers resume their prior conversation rather than
starting from scratch on each pass. The rule everywhere is "capture once, keep":
store the resolved id from the first successful run and pass it to the reviewer on
every subsequent run. Gemini and Custom reviewers always run fresh.

**Per-provider mechanics** (`native/src/sessions/reviewer.rs`,
`native/src/sessions/reviewer_output.rs`):

- **Claude**: the first run mints an id with `--session-id <uuid>` (a UUID
  generated by `new_reviewer_session_id()`); all subsequent runs pass
  `--resume <uuid>`. Claude writes plain text stdout; `reviewer_output.rs`
  extracts the text directly.
- **Codex**: runs in JSON-event mode (`codex exec --json`); the session id is
  emitted as a structured event and captured from the stream by `reviewer_output.rs`.
  Subsequent runs use `codex exec resume <id> --json`.
- **OpenCode**: runs with `--format json`; `reviewer_output.rs` extracts the session
  id from the JSON event stream. Subsequent runs add `--session <id> --format json`.

**Where ids are persisted:**

- `review_loops.reviewer_session_id` — the active reviewer's session id for the
  task loop. **Reset to `NULL`** when the loop is restarted via `start_pair_loop`
  (a restart is intentionally a fresh context). Reused across all idle rounds while
  the loop stays running.
- `pr_reviews.reviewer_session_id` — the single PR review's reviewer session id.
  **Preserved across reruns** (`rerun_pr_review` re-runs against the latest PR head
  but continues the same reviewer conversation, so repeat reviews build on earlier
  findings).
- **Consensus runs** keep per-reviewer session ids in memory for the duration of one
  consensus run. They are not persisted to SQLite (no new column on `pr_review_runs`
  or `pr_review_reviewers`).

**Codex/OpenCode live-output caveat**: because these reviewers run in JSON-event
mode rather than streaming plain text, the "Watch reviewer" live output arrives as
one chunk when the command completes, not token-by-token. This affects the task
Review tab and the PR review detail's live pane.

Inspect stored ids:

```bash
sqlite3 "/path/to/nectus.sqlite3" "select task_id, status, reviewer_session_id from review_loops;"
sqlite3 "/path/to/nectus.sqlite3" "select id, status, verdict, reviewer_session_id from pr_reviews order by id desc limit 10;"
```

## Debug Logging

Rust tracing uses the `RUST_LOG` environment variable. Default filter:

```text
nectus_desktop_lib=info
```

Run with more backend detail:

```bash
RUST_LOG=nectus_desktop_lib=debug pnpm desktop:dev
```

Useful backend log messages include:

- Opening the app data directory.
- Starting an agent session with task id, session id, agent, cwd, and resume
  flag.
- Watching a Codex session log.
- Failure to emit session or review events.
- Review start, recorded verdict, reviewer output, and review-loop errors.

## Database Inspection

The database path is printed at desktop startup. Once you have the path, inspect
it with:

```bash
sqlite3 "/path/to/nectus.sqlite3" ".tables"
sqlite3 "/path/to/nectus.sqlite3" "select id, title, status, has_worktree, branch_name, active_session_id, last_session_id from tasks order by updated_at desc;"
sqlite3 "/path/to/nectus.sqlite3" "select task_id, status, last_error from review_loops;"
sqlite3 "/path/to/nectus.sqlite3" "select task_id, verdict, error from review_runs order by id desc limit 20;"
```

Do not edit the database directly unless the user explicitly asks for recovery
work.

## Common Debugging Flows

### Project Cannot Be Added

Check:

- The path exists and is a directory.
- `git -C <path> rev-parse --show-toplevel` succeeds.
- The desktop app can access the selected folder.

Relevant code:

- `native/src/git_ops/mod.rs` (repo/branch validation, worktree lifecycle,
  `is_dirty`)
- `native/src/db/mod.rs`

### Worktree Task Fails To Create

Check:

- Blank branch names generate a `task-...` branch; entered branch names must
  pass git-safe validation.
- Branch name does not contain whitespace, `..`, `~`, `^`, `:`, `?`, `*`, `[`,
  backslash, `//`, trailing `/`, or `.lock`.
- The worktree path does not already exist.
- The repo has at least one remote.
- `git ls-remote --symref <remote> HEAD` can resolve the remote default branch.
- `git fetch --prune <remote>` succeeds.

Relevant code:

- `native/src/git_ops/mod.rs` (remote resolution, worktree create/remove/branch
  lifecycle)
- `native/src/db/mod.rs`

### Agent Command Fails To Start

Check:

- The profile command is correct in Settings.
- The command is executable if it is an explicit path.
- The GUI environment PATH contains the CLI location, or the CLI is in a known
  fallback location such as `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`,
  or `/usr/local/bin`.
- Extra args and environment lines in Settings are valid for that CLI.

Symptom — `env: node: No such file or directory` with **exit status 127**: the
agent binary was found, but a Finder/Dock-launched app has a minimal PATH so the
node-based CLI (e.g. Codex or OpenCode) cannot exec `node`. The fix is already
wired: both the PTY session (`native/src/sessions/mod.rs`) and the reviewer
launch (`native/src/sessions/reviewer.rs`) set the spawned command's `PATH` to
`process_util::augmented_path()`. If `node` still lives somewhere unusual (e.g.
nvm), add that dir to `process_util::third_party_bin_dirs` or set `PATH` on the
agent profile's env. See AGENTS.md → *Spawning External CLIs* for the full rule.

Relevant code:

- `native/src/sessions/command.rs` (binary resolution)
- `native/src/process_util.rs` (`augmented_path`, `third_party_bin_dirs`)
- `src/components/SettingsPage.tsx`

### Terminal Is Blank Or Input Does Not Work

Check:

- The task has an `active_session_id`.
- The session process started successfully in the backend logs.
- `session_output` events are being emitted.
- `send_session_input` is called from keyboard input and from file drops over
  the terminal host.
- App-authored prompts such as review feedback and `Create PR` use
  `submit_session_input`; the backend writes and flushes the prompt before
  sending terminal Enter so Codex sees submission as a separate key action.
- The selected task is open in the focused terminal workspace and the terminal
  host has nonzero height; `src/TerminalPane.tsx` observes that host resize and
  sends `resize_session` with the fitted PTY rows and columns.
- `session_output_snapshot` only works for running sessions.

Relevant code:

- `src/TerminalPane.tsx`
- `src/hooks/useSessionCommands.ts`
- `native/src/sessions/mod.rs`

### Terminal Shows Doubled / Ghosted Text Or Tofu Boxes

Agents like Claude Code repaint a multi-line sticky UI (input box + status line)
with rapid cursor-addressed redraws. Those redraws only land correctly when
xterm's grid matches the PTY's grid; when they don't, the old lines aren't
overwritten and you see **duplicate spinner/footer lines**. `src/TerminalPane.tsx`
defends this on several fronts:

- **Terminal height.** The pane height is driven by the layout (the `height:100%`
  chain `html`→`#root`→`.nx-app`→`.task-workspace`→`.terminal-host`). A very short
  pane (≈10 rows) leaves the agent no room and its redraws overlap — confirmed via
  the `[term-diag]` logs as the real cause of "double rendering". If the terminal
  looks cramped, the window/pane is too short, not a renderer bug.
- **No redundant SIGWINCH.** `syncTerminalToPane` only calls `resizeSession` when
  the fitted rows/cols actually changed (tracked in `CachedTerminal.ptyRows/Cols`).
  A no-op resize would force the agent to repaint and re-ghost.
- **Coalesced resizes.** The `ResizeObserver` debounces fits into one per animation
  frame, so a window drag repaints the agent UI once, not on every pixel.
- **Generation-size replay.** On first attach, history is replayed at the recorded
  generation width before fitting to the pane (`loadSnapshotDelta`), so buffered
  cursor-addressed redraws reproduce on the right rows.
- **Unicode 11 widths.** `Unicode11Addon` + `terminal.unicode.activeVersion = "11"`
  make emoji/CJK occupy the cell count the agent assumes; a width disagreement
  desyncs cursor math.
- **GPU renderer.** `loadWebglRenderer` loads `@xterm/addon-webgl` after
  `terminal.open(...)`; the DOM renderer leaves stale cells and renders `■` tofu.
  If the console logs `Terminal: WebGL2 renderer unavailable, using the DOM
  renderer`, WebGL2 was missing and xterm fell back to DOM (artifacts can return);
  a lost GPU context disposes the addon (`onContextLoss`) and also reverts to DOM.

Hyperlinks: `WebLinksAddon` highlights URLs and opens clicks via
`api.openExternalUrl` (Tauri opener → system browser), not inside the webview.

Relevant code:

- `src/TerminalPane.tsx` (`getOrCreateTerminal`, `syncTerminalToPane`,
  `loadWebglRenderer`)

### Session Resume Is Disabled

Resume is only supported for task agent kinds `codex`, `claude`, and `opencode`.

Check:

- The task has `last_session_id`.
- The task has an agent profile id.
- The agent kind is Codex, Claude, or OpenCode.
- For Codex, a matching JSONL `session_meta` file was found for the task cwd
  after the Nectus session start.
- For OpenCode, the local server `/session` response exposed the running session
  id before the task session stopped or exited.

Relevant code:

- `src/components/TaskWorkspace.tsx`
- `native/src/lib.rs`
- `native/src/sessions/codex.rs`

### Finished Or Needs-Input Count Looks Wrong

Check:

- `session_idle` or `session_needs_input` was emitted.
- The event task id still exists in the frontend task list.
- Starting, resuming, stopping, sending input, or marking done may have cleared
  the attention marker.
- Codex JSONL persisted the event you expect.
- The Nectus session was still active when Codex first wrote matching
  `session_meta` metadata; metadata discovery stops when the task session ends.
- The matching `session_meta` was not a Codex subagent or auto-review session.
- For OpenCode, the CLI was launched with the Nectus-owned localhost port and the
  `/event` stream delivered a `session.idle` (idle) or a permission/question ask
  (needs input) for the discovered session id.

Relevant code:

- `src/sessionAttention.ts`
- `src/hooks/useEventBridge.ts` (the mount-once bridge that turns these events
  into the Query-cache / Zustand-store attention markers)
- `native/src/sessions/codex.rs`
- `docs/codex-session-jsonl.md`

### App Freezes / Goes Unresponsive When Stopping A Session

Synchronous Tauri commands share the main UI thread with the Wry event loop, so
any blocking work — or any `app.emit(...)` back into the webview — done inline in
a `fn` command freezes the whole app until it returns. Stopping a session does
blocking teardown (kill + reap the PTY child, DB writes, an OpenCode server probe)
and then emits `session_exited`, so it must run off the main thread.

Check:

- `stop_session` is an `async` command that runs the teardown via
  `tauri::async_runtime::spawn_blocking(...).await`, so the work and the
  post-`.await` `session_exited` emit happen off the main thread (the same
  background-emit pattern the reader thread uses on natural exit).
- `SessionManager::stop` removes the session from the map under the lock and then
  drops the `sessions` mutex before `child.kill()`/`child.wait()` and the metadata
  /DB work — holding it would stall every other session command and live reader
  thread behind the teardown.

Rule: never do blocking teardown or `emit` inside a synchronous main-thread
command. Offload to `spawn_blocking`, and never hold the global `sessions` mutex
across `wait()`, network, or DB calls.

Relevant code:

- `native/src/lib.rs` (`stop_session`)
- `native/src/sessions/mod.rs` (`SessionManager::stop`, the reader thread's
  matching off-lock `wait()`)

### macOS Notifications Do Not Appear

Current bundle identifier:

```text
com.hvp17.nectus
```

Check:

- `native/capabilities/default.json` includes `notification:default`.
- `native/src/lib.rs` initializes `tauri_plugin_notification`.
- `src/api.ts` requests permission before sending notifications.
- System Settings includes the app under Notifications.

Reset notification permission:

```bash
tccutil reset UserNotifications com.hvp17.nectus
```

If macOS does not re-prompt after reset, use System Settings first. For local
development only, a temporary bundle identifier change in
`native/tauri.conf.json` can force a fresh prompt. Change it back before
shipping.

### Review Does Not Run

Check:

- The review loop status is `running` or `reviewing`.
- Manual review runs have a running worker session for the task. Automatic review
  after idle still requires a Codex, Claude, or OpenCode session that emits
  `session_idle`.
- Manual review runs should emit `review_loop_updated` with status
  `reviewing` before the reviewer command finishes.
- The reviewer profile command resolves and exits successfully. An exit status
  127 with `env: node: No such file or directory` is the minimal-PATH problem —
  see *Agent Command Fails To Start* above; the reviewer launch sets
  `process_util::augmented_path()` to fix it.
- Claude and Gemini reviewer profiles run headless with `-p`; Codex reviewers run
  non-interactively with `codex exec`; OpenCode reviewers run with `opencode run`;
  custom reviewers read the generated prompt from stdin. An exit status 1 with
  `Error: stdin is not a terminal` means a Codex reviewer was launched as the
  interactive TUI instead of through `codex exec` — `build_reviewer_args` in
  `native/src/sessions/reviewer.rs` adds the provider-specific headless subcommand.
- Reviewer output carries one `NECTUS_VERDICT:` marker line: `CLEAN`, `BLOCKERS`,
  or `FEEDBACK` (the loop maps these to `pass`/`needs_changes`/`feedback`). No
  marker → `unknown`; there is no natural-language fallback. The marker line is
  stripped before the review is stored or forwarded to the worker.
- Worker feedback is written to the active worker PTY and submitted with carriage
  return (`\r`), matching the terminal Enter key.
- External PR reviews share the same marker: a finished one shows **Inconclusive**
  when the reviewer omitted the `NECTUS_VERDICT: BLOCKERS|CLEAN` line that
  `parse_pr_review_output` looks for. The shared marker, token enum, and
  parse/strip helper live in `native/src/sessions/verdict.rs`; `pr_verdict.rs`
  (single/consensus) and `review_loop.rs` (task loop) are thin adapters mapping the
  token to their domain enums. The review text is still stored; only the verdict could not be
  derived. Inspect it with
  `select status, verdict from pr_reviews order by id desc limit 10;`.
- Consensus PR reviews never "converge" while any reviewer stays **Inconclusive**
  (a failed or marker-less round counts as inconclusive), so they run to the round
  cap and the synthesizer decides the verdict. Inspect a run's rounds with
  `select round, reviewer_profile_id, verdict from pr_review_runs where pr_review_id = <id> order by id;`
  and the outcome with `select mode, rounds_completed, converged, verdict from pr_reviews where id = <id>;`.

Relevant code:

- `native/src/sessions/codex.rs`
- `native/src/sessions/review_loop.rs`
- `src/components/TaskWorkspace.tsx`

### Auto-Update Does Not Offer An Update

Nectus ships a Tauri 2 auto-updater for the Apple Silicon (aarch64) build. The
public repo `github.com/hvp17/nectus` hosts releases, so the updater reads them
directly with no token. Integrity is secured by Tauri minisign signing
(independent of Apple); the app is not yet Apple-notarized, so the **first**
download triggers a Gatekeeper "cannot verify"/"damaged" warning the user clears
with right-click → Open. Notarization is a future add-on, out of scope here.

The update state machine lives in `src/hooks/useAppUpdate.ts`, with the
Tauri-guarded wrapper in `src/lib/update.ts` (all no-ops outside Tauri). It runs
one silent check shortly after launch and again on demand from
Settings → About & Updates → "Check for updates"
(`src/components/settings/UpdateCard.tsx`); `src/AppRouter.tsx` (`AppLayout`) mounts
`useAppUpdate` plus `useAppUpdateToast.ts` (the "Update available (vX) → Install" and
"Update installed → Relaunch" sonner toasts).

`UpdateStatus` values:

| Status | Meaning |
| --- | --- |
| `idle` | No check run yet. |
| `checking` | A check is in flight. |
| `upToDate` | The endpoint reported no newer version. |
| `available` | A newer version was found; install not yet started. |
| `downloading` | Download in progress (`progress` runs `0..1`). |
| `ready` | Downloaded and installed; relaunch to apply. |
| `error` | Check or install failed (`error` holds the message). |

The hook also exposes `info`, `currentVersion`, `progress`, `error`, and
`lastCheckedAt` for the About card.

The updater fetches the manifest from:

```text
https://github.com/hvp17/nectus/releases/latest/download/latest.json
```

Expected `latest.json` shape (Apple Silicon only):

```json
{
  "version": "X.Y.Z",
  "notes": "release notes",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<minisign>", "url": "<.app.tar.gz url>" }
  }
}
```

Common failure symptoms:

- **Signature verification fails on install** (`error` status): a pubkey
  mismatch — the `latest.json` `signature` was produced by a private key that
  does not match the base64 `pubkey` in `native/tauri.conf.json`'s
  `plugins.updater` block. The two must be from the same minisign keypair (the
  CI signing secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must match the committed public key).
- **Check silently reports "up to date"** (`upToDate`): the release is missing,
  draft, or unpublished, so `…/releases/latest/download/latest.json` 404s and the
  updater treats it as no update. Confirm the GitHub Release is published and
  carries `latest.json` (CI auto-publishes it on a version bump merged to `main`).
- **No update offered even with a newer build out**: the published `version` is
  not strictly higher than the installed one. The published `version` comes from
  `package.json`; if it was not bumped, no release was cut.

Rust wiring (`native/src/lib.rs` `run()`): registers
`tauri_plugin_process::init()` and
`tauri_plugin_updater::Builder::new().build()`. `native/tauri.conf.json` sets
`bundle.createUpdaterArtifacts: true` and the `plugins.updater` block (endpoint
+ base64 `pubkey`, safe to commit). `native/capabilities/default.json` grants
`updater:default` and `process:allow-restart` (the latter powers the relaunch).

Release procedure: see [README](../README.md#releases--auto-update) and
AGENTS.md → *Product Defaults*. In short, `package.json`'s `version` is the
single source of truth (`native/tauri.conf.json` reads it; `native/Cargo.toml`
is frozen at `0.0.0` and never bumped); `.github/workflows/release.yml` runs on
every push to `main`, and **CI creates the `vX.Y.Z` tag itself** — there is no
manual tag step. Installed copies pick up a published release on their next
launch check or via the About card.

Relevant code:

- `src/hooks/useAppUpdate.ts`, `src/hooks/useAppUpdateToast.ts`
- `src/lib/update.ts`
- `src/components/settings/UpdateCard.tsx`, `src/components/SettingsPage.tsx`
- `native/src/lib.rs`, `native/tauri.conf.json`,
  `native/capabilities/default.json`
- `.github/workflows/release.yml`

## Verification Commands

Frontend tests:

```bash
pnpm test
```

Frontend build:

```bash
pnpm build
```

Rust tests:

```bash
cd native
cargo test
```

If Rust tests that execute `git` fail because `git` cannot be found, rerun with:

```bash
cd native
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH cargo test
```

For release-impacting changes:

```bash
pnpm desktop:build
```
