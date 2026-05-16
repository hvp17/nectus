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
| `app_settings` | Default agent, worktree pattern, branch prefix, theme, and density. |
| `tasks` | Primary work item, status, prompt, optional worktree, active session, saved session. |
| `review_loops` | Current pair-loop configuration and status per task. |
| `review_runs` | Reviewer prompts, outputs, verdicts, and errors by round. |

Schema owner: `native/src/db/migrations.rs`

Row mapping and enum parsing: `native/src/db/rows.rs`

Persistence API: `native/src/db/mod.rs`

### Frontend State

The frontend keeps transient UI state in React:

- Selected project and selected task.
- Task attention markers.
- Detail-pane expansion.
- Create-task modal drafts.
- Settings/profile edit drafts.

The source of truth for saved project, task, profile, settings, and review-loop
data remains SQLite through Tauri commands.

Main owner: `src/hooks/useApp.ts`

### Codex JSONL

For Codex sessions, Nectus watches persisted rollout JSONL under:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

The watcher:

- Finds the latest file whose `session_meta.payload.cwd` matches the task cwd
  and whose timestamp is after the Nectus session start.
- Reads appended lines every 500 ms.
- Emits `session_idle` for `event_msg.payload.type == "task_complete"` or
  `event_msg.payload.type == "turn_complete"`.
- Attempts to emit `session_needs_input` for explicit approval, permission,
  user-input, elicitation, patch-approval, confirmation, or needs-input event
  names.

The JSONL protocol details and caveats are in
[codex-session-jsonl.md](codex-session-jsonl.md).

Important limitation: several approval and input request events are defined by
Codex but are not persisted by default in the checked rollout policy. Treat
`session_idle` as high confidence. Treat input-needed detection as a feature that
must be verified against the Codex version and launch mode being used.

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
| `list_agent_profiles` | Load agent profiles. |
| `upsert_agent_profile` | Create or update an agent profile. |
| `start_pair_loop` | Enable reviewer automation for a task. |
| `stop_pair_loop` | Stop reviewer automation for a task. |
| `get_task_review_loop` | Load a task's current review loop. |
| `list_task_review_runs` | Load stored reviewer runs for a task. |
| `start_session` | Start an agent in the task cwd. |
| `resume_session` | Resume a Codex or Claude saved session. |
| `stop_session` | Stop a running PTY child process. |
| `resize_session` | Resize the PTY. |
| `send_session_input` | Write keyboard input or terminal-dropped file paths into the PTY. |
| `session_output_snapshot` | Load buffered terminal output for a running session. |

## Events

Backend-to-frontend events:

| Event | Payload | Source |
| --- | --- | --- |
| `session_output` | PTY output chunk and stream offset. | `native/src/sessions/mod.rs` |
| `session_exited` | Session id and optional exit code. | `native/src/sessions/mod.rs`, `native/src/lib.rs` |
| `session_idle` | Task id, session id, Codex turn id, optional message. | `native/src/sessions/codex.rs` |
| `session_needs_input` | Task id, session id, reason, optional prompt. | `native/src/sessions/codex.rs` |
| `review_loop_updated` | Review-loop state and optional review run. | `native/src/sessions/review_loop.rs` |

Frontend event listeners:

- `src/TerminalPane.tsx` listens for `session_output`, `session_exited`, and
  Tauri v2 `getCurrentWebview().onDragDropEvent()` file-path drops for the
  active terminal.
- `native/tauri.conf.json` keeps `dragDropEnabled` enabled on the main window so
  Tauri emits native file-drop events instead of relying on browser-only drops.
- `src/hooks/useSessionEvents.ts` listens for attention events and sends
  notifications.
- `src/hooks/useApp.ts` listens for `review_loop_updated`.

## Task Tracking Fields

Important `tasks` columns:

- `status`: `planned`, `in_progress`, `review`, or `done`.
- `prompt`: optional task instructions sent to a new session.
- `agent_profile_id`: preferred agent profile for the task.
- `has_worktree`: whether the task owns a git worktree.
- `branch_name`: set only when `has_worktree = 1`.
- `worktree_path`: set only when `has_worktree = 1`.
- `active_session_id`: running session lock. Cleared on app startup, session
  stop, natural exit, and app close.
- `last_session_id`: saved session id used for resume when supported.
- `last_session_agent`: command or agent kind used for the last session.
- `last_session_cwd`: project path or worktree path used for the last session.
- `last_session_label`: Codex label from the latest matching JSONL metadata when
  available.

The schema enforces that direct-edit tasks have no branch/worktree path and
worktree tasks have both.

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
- Review round start, recorded verdict, and review-loop errors.

## Database Inspection

The database path is printed at desktop startup. Once you have the path, inspect
it with:

```bash
sqlite3 "/path/to/nectus.sqlite3" ".tables"
sqlite3 "/path/to/nectus.sqlite3" "select id, title, status, has_worktree, branch_name, active_session_id, last_session_id from tasks order by updated_at desc;"
sqlite3 "/path/to/nectus.sqlite3" "select task_id, status, current_round, max_rounds, last_error from review_loops;"
sqlite3 "/path/to/nectus.sqlite3" "select task_id, round, verdict, error from review_runs order by id desc limit 20;"
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

- Branch name is not empty.
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

Relevant code:

- `native/src/sessions/command.rs`
- `src/components/SettingsPage.tsx`

### Terminal Is Blank Or Input Does Not Work

Check:

- The task has an `active_session_id`.
- The session process started successfully in the backend logs.
- `session_output` events are being emitted.
- `send_session_input` is called from keyboard input and from file drops over
  the terminal host.
- Dragging the task-detail terminal resize separator changes the terminal host
  height; `src/TerminalPane.tsx` observes that host resize and sends
  `resize_session` with the fitted PTY rows and columns.
- `session_output_snapshot` only works for running sessions.

Relevant code:

- `src/TerminalPane.tsx`
- `src/hooks/useSessionCommands.ts`
- `native/src/sessions/mod.rs`

### Session Resume Is Disabled

Resume is only supported for task agent kinds `codex` and `claude`.

Check:

- The task has `last_session_id`.
- The task has an agent profile id.
- The agent kind is Codex or Claude.
- For Codex, a matching JSONL `session_meta` file was found for the task cwd
  after the Nectus session start.

Relevant code:

- `src/components/TaskDetailDrawer.tsx`
- `native/src/lib.rs`
- `native/src/sessions/codex.rs`

### Finished Or Needs-Input Count Looks Wrong

Check:

- `session_idle` or `session_needs_input` was emitted.
- The event task id still exists in the frontend task list.
- Starting, resuming, stopping, sending input, or marking done may have cleared
  the attention marker.
- Codex JSONL persisted the event you expect.

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

### Pair Loop Does Not Run

Check:

- The review loop status is `running`.
- The worker session is a Codex session that emits `session_idle`.
- The reviewer profile command resolves and exits successfully.
- Reviewer output begins with `PASS`, contains a blocking-review phrase, or the
  loop will be marked `error` as unknown.
- `max_rounds` is between 1 and 10.

Relevant code:

- `native/src/sessions/codex.rs`
- `native/src/sessions/review_loop.rs`
- `src/components/TaskDetailDrawer.tsx`

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
