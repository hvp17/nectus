# Feature Map

This document maps current Nectus Desktop behavior to the files that own it.

## Projects

Projects are existing local git repositories. The app validates a selected
folder with git before saving it.

- Frontend entry points: `src/components/Sidebar.tsx`, `src/hooks/useApp.ts`
- Dialog wrapper: `src/api.ts`
- Backend command: `add_repo`
- Git validation: `native/src/git_ops.rs`
- Persistence: `repos` table in `native/src/db/schema.rs`

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
- Task-card pointer drag tracking: `src/hooks/useTaskCardPointerDrag.ts`
- Detail pane: `src/components/TaskDetailDrawer.tsx`
- Dashboard layout and board scrolling: `src/styles.css`
- Frontend state orchestration: `src/hooks/useApp.ts`
- Backend commands: `create_task`, `list_tasks`, `update_task_metadata`,
  `delete_task`
- Persistence: `tasks` table in `native/src/db/schema.rs`

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

- Settings page composition: `src/components/SettingsPage.tsx`
- Agent profile editor: `src/components/settings/ProfileEditor.tsx`
- Profile draft parsing and normalization: `src/components/settings/profileDrafts.ts`
- Frontend API: `src/api.ts`
- Command resolution: `native/src/sessions/command.rs`
- Provider-specific launch arguments: `native/src/sessions/agents/`
- Persistence: `agent_profiles` table in `native/src/db/schema.rs`
- Persistence API: `native/src/db/agent_profiles.rs`

Command resolution checks PATH first, then common user binary locations.
Provider modules own command arguments and app-specific fallback locations, such
as Codex app bundle resource paths.

## Sessions And Terminal

Sessions are app-owned child processes attached to an embedded PTY.

Current behavior:

- A task can have only one active session.
- Direct-edit tasks launch in the project path.
- Worktree-backed tasks launch in the worktree path.
- New task prompts are written to the PTY after launch.
- Dropping files on the terminal inserts their escaped paths into the active
  session input, matching the local terminal workflow for Codex image/file paths.
- The task detail terminal can expand full width with the inspector and can be
  resized vertically from the separator above the terminal. The upper task
  controls use a compact session/status/metadata strip and scroll when the
  terminal is enlarged.
- Terminal output is streamed through the `session_output` Tauri event.
- Recent terminal output is buffered in memory for snapshot restore.
- Closing the app stops owned sessions and clears active session ids.

Key files:

- Terminal UI: `src/TerminalPane.tsx`
- Session controls: `src/hooks/useSessionCommands.ts`
- Attention-clearing session control wrappers: `src/hooks/useSessionAttentionControls.ts`
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
- Codex `session_idle` comes from persisted JSONL `task_complete` or
  `turn_complete` events.
- Codex rollout metadata discovery stays active for the life of the running
  task session, so blank sessions can still emit attention markers after their
  first user turn writes JSONL metadata.
- Codex `session_needs_input` is best-effort because several input-request event
  names are defined by Codex but are not persisted by default.
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

## AI Review

AI review is a single reviewer pass over the selected task worktree.

Current behavior:

- Choose one reviewer profile in the task detail pane.
- Use the task workflow stepper's `Start review` step to run one reviewer pass.
- `Start review` switches the selected task UI to `reviewing` while the reviewer
  command runs, and the task workflow stepper shows the in-progress state.
- The task workflow stepper also shows a placeholder `Create PR` step and a
  `Move to done` step that marks the task complete.
- Manual `Start review` requires a running Codex worker session so blockers or
  feedback can be written back into that session.
- Claude and Gemini reviewers are run in headless prompt mode with `-p` and the
  generated review prompt. Custom reviewers receive the prompt on stdin.
- Reviewer output is parsed as:
  - `pass` when a line is exactly `NECTUS_NO_BLOCKERS`, `PASS`, or starts with
    `PASS:`.
  - `needs_changes` when a line is exactly `NECTUS_BLOCKERS`, or the output
    contains blocking-review phrases such as `Blocking issue`, `needs changes`,
    `request changes`, or `must fix`.
  - `feedback` when a line is exactly `NECTUS_FEEDBACK`.
  - `unknown` otherwise.
- Passing review marks the loop `passed` and moves the task to `done`.
- Task cards show the saved review status once a review exists, including
  completed `Review passed` state.
- Blocking review or feedback is written back into the worker PTY and submitted
  with the same Enter sequence as terminal input. That status is persisted as
  `feedback_sent` and shown as review feedback in the UI.
- Unknown reviewer output marks the loop `error`.

Key files:

- UI controls and latest run summary: `src/components/TaskDetailDrawer.tsx`
- Board review status label: `src/components/TaskCard.tsx`
- Frontend review-loop loading and event subscription: `src/hooks/useTaskReviewLoop.ts`
- Frontend API: `src/api.ts`
- Backend commands: `start_pair_loop`, `run_pair_review`, `stop_pair_loop`,
  `get_task_review_loop`, `list_task_review_runs`
- Runtime worker: `native/src/sessions/review_loop.rs`
- Persistence: `review_loops` and `review_runs` tables
- Persistence API: `native/src/db/review_loops.rs`

## Settings

Settings are persisted locally and include:

- Default agent profile
- Worktree root pattern
- Default branch prefix
- Theme
- Density

The worktree root pattern must include `{repoName}`. Existing project rows are
refreshed when the pattern changes.
When Theme is set to System, the UI follows OS color-scheme changes while the
app is running.

Key files:

- Settings page composition: `src/components/SettingsPage.tsx`
- Agent profile editor: `src/components/settings/ProfileEditor.tsx`
- Settings draft helpers: `src/components/settings/profileDrafts.ts`
- Theme hook: `src/hooks/useAppTheme.ts`
- Backend commands: `get_app_settings`, `update_app_settings`
- Persistence: `app_settings` table
