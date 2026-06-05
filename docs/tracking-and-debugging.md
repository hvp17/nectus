# Tracking And Debugging

This guide documents where Nectus Desktop tracks state, which events move that
state, and where to look when behavior is wrong.

## State Sources

### SQLite

The desktop app opens a local SQLite database named `nectus.sqlite3` inside the
Tauri app data directory. The app logs the resolved app data directory during
startup.

Core tables:

| Table | Purpose |
| --- | --- |
| `repos` | Saved project repositories and each project's default worktree root. |
| `agent_profiles` | CLI agent configuration, including command, model, args, and env. |
| `app_settings` | Default agent, worktree pattern, branch prefix, theme, density, and the JIRA board config (selected project + filter flags; the JQL is built from these). |
| `tasks` | Primary work item, status, prompt, optional worktree, active session, saved session, and optional JIRA story link. |
| `review_loops` | Current review configuration and status per task. |
| `review_runs` | Reviewer prompts, outputs, verdicts, and errors by review attempt. |
| `pr_reviews` | External pull-request reviews: PR metadata, status, `verdict` (`passed`/`blockers`/`inconclusive`, set when a review reaches `ready`), Markdown output, ephemeral worktree path, and the consensus columns `mode` (`single`/`consensus`), `max_rounds`, `rounds_completed`, `converged`. For consensus, `reviewer_profile_id` is the synthesizer. |
| `pr_review_reviewers` | Consensus participants: the reviewer profiles taking part in a consensus PR review, in selection order. Cascade-deletes with the review. |
| `pr_review_runs` | Consensus per-reviewer, per-round outputs: `round`, `verdict`, Markdown `output`, and `error`. One row per reviewer per round. Cascade-deletes with the review. |

Schema owner: `native/src/db/schema.rs`

Row mapping and enum parsing: `native/src/db/rows.rs`

Persistence APIs:

- `native/src/db/mod.rs`: database setup plus project, settings, task, and
  session-state records.
- `native/src/db/agent_profiles.rs`: agent profile queries and upserts.
- `native/src/db/review_loops.rs`: review-loop and review-run records.
- `native/src/db/pr_reviews.rs`: PR-review records and `owner/repo` → project
  resolution.

### Frontend State

The frontend keeps transient UI state in React:

- Selected project and selected task.
- Task attention markers.
- Sidebar Tasks section derived from the local task list, with active-session
  rows driven by `tasks.activeSessionId` and task attention markers.
- Create-task modal drafts.
- Settings/profile edit drafts.
- Review-loop detail state loaded for the selected task.
- Review status is included in task summaries so the board can label cards
  before a task is opened. Review is modeled as a single pass.

The source of truth for saved project, task, profile, settings, and review-loop
data remains SQLite through Tauri commands.

Main owner: `src/hooks/useApp.ts`

Focused state hooks:

- `src/hooks/useSessionEvents.ts`: session attention events and notifications.
- `src/hooks/useSessionAttentionControls.ts`: session controls that clear stale
  attention before start, resume, stop, and input flows.
- `src/components/Sidebar.tsx`: shadcn/sidebar shell, Projects section, and
  Settings footer action.
- `src/components/TaskQuickAccessPanel.tsx`: shadcn/sidebar Tasks section,
  including total task count, add-task, active-session open, and stop actions.
- `src/hooks/useTaskDeletion.ts`: task deletion workflow and deletion toasts.
- `src/components/TaskDeleteDialog.tsx`: shared delete confirmation used by
  task cards and the selected-task inspector.
- `src/hooks/useTaskReviewLoop.ts`: selected-task review-loop data and
  `review_loop_updated` events, including board-summary updates for any task.
- `src/components/TaskCard.tsx`: board card review-loop status label.
- `src/hooks/useCreateTaskForm.ts`: create-task modal drafts.

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
| `create_task` | Create a direct-edit task or create a git worktree-backed task. |
| `list_tasks` | Load task summaries and dirty-state checks. |
| `update_task_metadata` | Update title, status, or PR URL. |
| `delete_task` | Delete a task and remove its worktree when applicable. |
| `task_diff_summary` | List the files a task changed: a worktree task's branch vs the locally-resolved base (`origin/HEAD` merge-base, committed + uncommitted), or a direct-edit task's working tree vs `HEAD`. Returns the base label plus per-file change kind and `+/-` counts. |
| `task_diff_file` | Return the unified patch for one file in a task's diff (lazy-loaded per file; untracked files diff against `/dev/null`). |
| `jira_status` | Report whether `acli` is installed, authenticated, and the active site. |
| `jira_list_projects` | List visible JIRA projects for the board's project picker (`acli jira project list --json`). |
| `jira_search_board` | Load board work items; the JQL is built from the structured board config (project + filter flags), so no JQL is typed. |
| `jira_get_work_item` | Fetch a single work item (e.g. to backfill a story description). |
| `jira_transition_work_item` | Transition a work item to a target status (optimistic; fails on illegal workflow moves). |
| `jira_assign_work_item` | Assign a work item to a user. |
| `jira_comment_work_item` | Add a comment to a work item. |
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
| `resume_session` | Resume a Codex or Claude saved session. |
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
| `session_activity` | Task id, session id, and the agent's latest human-readable activity line (ANSI-stripped tail of PTY output, throttled and de-duplicated). | `native/src/sessions/mod.rs` |
| `session_exited` | Session id and optional exit code. | `native/src/sessions/mod.rs`, `native/src/lib.rs` |
| `session_idle` | Task id, session id, Codex turn id, optional message. | `native/src/sessions/codex.rs` |
| `session_needs_input` | Task id, session id, reason, optional prompt. | `native/src/sessions/codex.rs` |
| `review_loop_updated` | Review-loop state and optional review run. | `native/src/sessions/review_loop.rs` |
| `review_output` | Task id, a chunk of the task reviewer's live stdout, and the chunk's byte offset (a `0` offset starts a new run). Streamed only by the task review loop, not by PR reviews. | `native/src/sessions/review_loop.rs` |
| `pr_review_updated` | Updated external PR review (status, verdict, metadata, Markdown output), plus an optional `latest_run` carrying the consensus round output that triggered the update. | `native/src/sessions/pr_review.rs`, `native/src/sessions/pr_consensus.rs` |

Frontend event listeners:

- `src/TerminalPane.tsx` listens for `session_output`, `session_exited`, and
  Tauri v2 `getCurrentWebview().onDragDropEvent()` file-path drops for the
  active terminal.
- `native/tauri.conf.json` keeps `dragDropEnabled` enabled on the main window so
  Tauri emits native file-drop events instead of relying on browser-only drops.
- `src/hooks/useSessionEvents.ts` listens for attention events and sends
  notifications. It also records `session_activity` into a per-task `liveLines`
  map (cleared on `session_exited`) that drives the live "what it's doing" line on
  task cards and Mission Control rows.
- `src/hooks/useTaskReviewLoop.ts` listens for `review_loop_updated` and
  `review_output`, accumulating the live reviewer stdout for the selected task into
  the read-only Review pane (`src/components/ReviewTerminalPane.tsx`).
- `src/hooks/usePrReviews.ts` listens for `pr_review_updated` and notifies when a
  review becomes ready or errors.

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
- `last_session_id`: saved session id used for resume when supported.
- `last_session_agent`: command or agent kind used for the last session.
- `last_session_cwd`: project path or worktree path used for the last session.
- `last_session_label`: Codex label from the latest matching JSONL metadata when
  available.
- `jira_issue_key` / `jira_issue_summary` / `jira_issue_url`: optional local-only
  link to a JIRA story, captured at attach time; null when the task is unlinked.
  Set/cleared via `set_task_jira_link`; never written back to JIRA.

The schema enforces that direct-edit tasks have no branch/worktree path and
worktree tasks have both.

Additive columns (such as the `jira_*` task fields above and the `app_settings` JIRA
board config — `jira_board_project`, `jira_filter_my_issues`, `jira_filter_unresolved`,
`jira_filter_current_sprint`, plus the legacy `jira_board_jql` / `jira_site_url`) are
introduced by `run_migrations` in `native/src/db/schema.rs`, which `ALTER TABLE`s any
missing column on every open so existing databases upgrade in place.

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

- `native/src/git_ops.rs`
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

- `native/src/git_ops.rs`
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
node-based CLI (e.g. Codex) cannot exec `node`. Both the PTY session
(`native/src/sessions/mod.rs`) and the reviewer launch
(`native/src/sessions/review_loop.rs`) set the spawned command's `PATH` to
`process_util::augmented_path()` — the current PATH plus
`process_util::third_party_bin_dirs` — so nested tools resolve. If `node` lives
somewhere unusual (e.g. nvm), add that dir to `third_party_bin_dirs` or set `PATH`
on the agent profile's env. See AGENTS.md → *Spawning External CLIs*.

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

Resume is only supported for task agent kinds `codex` and `claude`.

Check:

- The task has `last_session_id`.
- The task has an agent profile id.
- The agent kind is Codex or Claude.
- For Codex, a matching JSONL `session_meta` file was found for the task cwd
  after the Nectus session start.

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

Relevant code:

- `src/sessionAttention.ts`
- `src/hooks/useSessionEvents.ts`
- `native/src/sessions/codex.rs`
- `docs/codex-session-jsonl.md`

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
  after idle still requires a Codex session that emits `session_idle`.
- Manual review runs should emit `review_loop_updated` with status
  `reviewing` before the reviewer command finishes.
- The reviewer profile command resolves and exits successfully. An exit status
  127 with `env: node: No such file or directory` is the minimal-PATH problem —
  see *Agent Command Fails To Start* above; the reviewer launch sets
  `process_util::augmented_path()` to fix it.
- Claude and Gemini reviewer profiles run headless with `-p`; Codex reviewers run
  non-interactively with `codex exec`; custom reviewers read the generated prompt
  from stdin. An exit status 1 with `Error: stdin is not a terminal` means a Codex
  reviewer was launched as the interactive TUI instead of through `codex exec` —
  `build_reviewer_args` in `native/src/sessions/review_loop.rs` adds the `exec`
  subcommand for `AgentKind::Codex`.
- Reviewer output contains an exact first-line verdict token:
  `NECTUS_NO_BLOCKERS`, `NECTUS_BLOCKERS`, or `NECTUS_FEEDBACK`. Legacy `PASS`
  and blocking-review phrase parsing are still accepted.
- Worker feedback is written to the active worker PTY and submitted with carriage
  return (`\r`), matching the terminal Enter key.
- External PR reviews are separate: a finished one shows **Inconclusive** when the
  reviewer omitted the `NECTUS_PR_VERDICT: BLOCKERS|CLEAN` line that
  `parse_pr_review_output` in `native/src/sessions/pr_review.rs` looks for. The
  review text is still stored; only the verdict could not be derived. Inspect it
  with `select status, verdict from pr_reviews order by id desc limit 10;`.
- Consensus PR reviews never "converge" while any reviewer stays **Inconclusive**
  (a failed or marker-less round counts as inconclusive), so they run to the round
  cap and the synthesizer decides the verdict. Inspect a run's rounds with
  `select round, reviewer_profile_id, verdict from pr_review_runs where pr_review_id = <id> order by id;`
  and the outcome with `select mode, rounds_completed, converged, verdict from pr_reviews where id = <id>;`.

Relevant code:

- `native/src/sessions/codex.rs`
- `native/src/sessions/review_loop.rs`
- `src/components/TaskWorkspace.tsx`

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
