# Feature Map

This document maps current Nectus Desktop behavior to the files that own it.

## Projects

Projects are existing local git repositories. The app validates a selected
folder with git before saving it.

- Frontend entry points: `src/components/Sidebar.tsx`, `src/hooks/useApp.ts`
- Dialog wrapper: `src/api.ts`
- Backend command: `add_repo`
- Git validation: `native/src/git_ops.rs`
- Persistence: `repos` table in `native/src/db/migrations.rs`

Adding the same project path again updates the existing row instead of creating
a duplicate.

## Tasks

Task is the primary work item. A task can be direct-edit or worktree-backed.

Direct-edit tasks:

- Store no branch or worktree path.
- Run the agent in the project repository path.
- Do not delete files when the task is deleted.

Worktree-backed tasks:

- Require a branch name.
- Create a sibling worktree path from the project worktree root pattern.
- Run the agent in that worktree path.
- Remove the git worktree when the task is deleted.

Task status values are:

- `planned`
- `in_progress`
- `review`
- `done`

Key files:

- Creation modal: `src/components/CreateTaskModal.tsx`
- Board and drag/drop status updates: `src/components/Workspace.tsx`
- Task card: `src/components/TaskCard.tsx`
- Detail pane: `src/components/TaskDetailDrawer.tsx`
- Frontend state orchestration: `src/hooks/useApp.ts`
- Backend commands: `create_task`, `list_tasks`, `update_task_metadata`,
  `delete_task`
- Persistence: `tasks` table in `native/src/db/migrations.rs`

## Agent Profiles

Agent profiles describe which CLI command to run and how to run it.

Seeded profiles:

- Codex: `codex`
- Claude: `claude`
- Gemini: `gemini`

Profiles can also be customized with:

- Name
- Agent kind
- Command
- Model
- Extra args, one per line
- Environment variables as `KEY=value`

Key files:

- Settings UI: `src/components/SettingsPage.tsx`
- Frontend API: `src/api.ts`
- Command resolution and launch arguments: `native/src/sessions/command.rs`
- Persistence: `agent_profiles` table in `native/src/db/migrations.rs`

Command resolution checks PATH first, then common user binary locations. Codex
also has fallback checks for the app bundle resource path.

## Sessions And Terminal

Sessions are app-owned child processes attached to an embedded PTY.

Current behavior:

- A task can have only one active session.
- Direct-edit tasks launch in the project path.
- Worktree-backed tasks launch in the worktree path.
- New task prompts are written to the PTY after launch.
- Terminal output is streamed through the `session_output` Tauri event.
- Recent terminal output is buffered in memory for snapshot restore.
- Closing the app stops owned sessions and clears active session ids.

Key files:

- Terminal UI: `src/TerminalPane.tsx`
- Session controls: `src/hooks/useSessionCommands.ts`
- Backend command registration: `native/src/lib.rs`
- PTY lifecycle: `native/src/sessions/mod.rs`

Emitted events:

- `session_output`
- `session_exited`
- `session_idle`
- `session_needs_input`
- `review_loop_updated`

## Session Resume

Codex and Claude profiles support resume from a saved session id.

Codex:

- New sessions launch normally; Nectus tracks the app-owned process with its own
  session id.
- Resume launches `codex resume <session-id>`.
- The model flag is not passed on Codex resume.
- The app finds the latest Codex JSONL session for the task cwd and saves its id
  and label when possible.

Claude:

- New sessions launch with `--session-id <session-id>`.
- Resume launches with `--resume <session-id>`.

Resume is disabled for Gemini and custom profiles unless their behavior is added
explicitly.

## Attention Tracking

Attention tracking is UI state derived from backend events.

- `session_idle` creates a finished attention marker.
- `session_needs_input` creates a needs-input marker.
- Starting, resuming, stopping, marking done, or sending input clears the marker
  for that task.
- Counts are shown in the dashboard metrics.
- macOS notifications are sent for idle and needs-input events when permission is
  granted.

Key files:

- Attention model: `src/sessionAttention.ts`
- Notification wrapper: `src/sessionNotifications.ts`
- Event listener hook: `src/hooks/useSessionEvents.ts`
- Codex event source: `native/src/sessions/codex.rs`

## AI Pair Loop

The AI pair loop is a worker-plus-reviewer flow.

Current behavior:

- Start a pair loop from the task detail pane.
- Choose a reviewer profile and max rounds from 1 to 10.
- On each Codex `session_idle` event, the backend runs the reviewer command in
  the task cwd with a generated review prompt.
- Reviewer output is parsed as:
  - `pass` when a line is exactly `PASS` or starts with `PASS:`.
  - `needs_changes` when it contains blocking-review phrases such as
    `Blocking issue`, `needs changes`, `request changes`, or `must fix`.
  - `unknown` otherwise.
- Passing review marks the loop `passed`.
- Blocking feedback before the max round is written back into the worker PTY.
- Blocking feedback at the max round marks the loop `max_rounds_reached`.
- Unknown reviewer output marks the loop `error`.

Key files:

- UI controls and latest run summary: `src/components/TaskDetailDrawer.tsx`
- Frontend API: `src/api.ts`
- Backend commands: `start_pair_loop`, `stop_pair_loop`,
  `get_task_review_loop`, `list_task_review_runs`
- Runtime worker: `native/src/sessions/review_loop.rs`
- Persistence: `review_loops` and `review_runs` tables

## Settings

Settings are persisted locally and include:

- Default agent profile
- Worktree root pattern
- Default branch prefix
- Theme
- Density

The worktree root pattern must include `{repoName}`. Existing project rows are
refreshed when the pattern changes.

Key files:

- Settings UI: `src/components/SettingsPage.tsx`
- Theme hook: `src/hooks/useAppTheme.ts`
- Backend commands: `get_app_settings`, `update_app_settings`
- Persistence: `app_settings` table

## Demo Mode

Appending `?demo=1` loads fixture data and avoids Tauri commands. Use it for
browser-only UI work, not for validating git, SQLite, notification, or PTY
behavior.

Key files:

- Fixtures: `src/demoData.ts`
- Demo branch in app state: `src/hooks/useApp.ts`
