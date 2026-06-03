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
- Can be deleted from the board card or the selected-task inspector.

Worktree-backed tasks:

- Accept a branch name or generate a `task-...` branch when the field is blank.
- Show the generated branch suggestion as the branch field placeholder, with the
  configured branch prefix applied.
- Create a sibling worktree path from the project worktree root pattern.
- Run the agent in that worktree path.
- Remove the git worktree when the task is deleted.
- Can be deleted from the board card or the selected-task inspector.

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
- Selected-task workspace and inspector rail: `src/components/TaskWorkspace.tsx`
- Shared task deletion confirmation: `src/components/TaskDeleteDialog.tsx`
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
- Selecting a task replaces the board with a focused terminal workspace. Running
  sessions render the live terminal front and center; tasks without an active
  session show launcher controls in the terminal stage.
- The shadcn/sidebar left rail groups Projects and Tasks as sibling sections.
  The Tasks section appears whenever tasks exist, shows the total local task
  count with an icon-only add-task action in the header, lists running tasks
  across projects with icon-only agent context, attention and task-status text,
  shows a worktree identifier icon only for worktree-backed tasks, and provides
  open and stop actions for active sessions.
- Task metadata, status, deletion, prompt, workflow, review controls, and review
  feedback live in the persistent right inspector rail.
- Terminal output is streamed through the `session_output` Tauri event.
- Recent terminal output is buffered in memory for snapshot restore.
- Closing the app stops owned sessions and clears active session ids.

Key files:

- Sidebar shell and Projects section: `src/components/Sidebar.tsx`
- Sidebar Tasks section: `src/components/TaskQuickAccessPanel.tsx`
- shadcn/sidebar primitives: `src/components/ui/sidebar.tsx`
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
- Codex `session_needs_input` comes from explicit input-request events when
  present, and from persisted `response_item` function calls named
  `request_user_input`.
- Codex rollout metadata discovery stays active for the life of the running
  task session, so blank sessions can still emit attention markers after their
  first user turn writes JSONL metadata.
- Codex subagent metadata, including auto-review or guardian approval sessions,
  is ignored so those internal completions do not mark the user task finished.
- Codex `session_needs_input` remains best-effort because several
  input-request event names are defined by Codex but are not persisted by
  default.
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

- Use the task workflow stepper's `Review with <reviewer>` action to run one
  reviewer pass.
- The review action shows the reviewer profile icon and name inline. Use the
  adjacent dropdown to switch reviewer profiles before starting the pass.
- The review action switches the selected task UI to `reviewing` while the reviewer
  command runs, and the task workflow stepper shows the in-progress state.
- The task workflow stepper enables `Create PR` for worktree tasks once the
  GitHub CLI is connected, or whenever a worker session is running. For worktree
  tasks with `gh` connected it opens the pull request directly and stores the URL
  on the task automatically; otherwise it submits a structured prompt into the
  active PTY, including the terminal Enter sequence, asking the agent to verify,
  commit, push, create the PR, and report the URL. See
  [GitHub Integration](github-integration.md).
- The task workflow stepper also shows a `Move to done` step that marks the
  task complete.
- PR URLs are stored on the task: captured automatically by the `gh`-driven flow,
  or written through task metadata when linked manually or by the agent.
- Manual review runs require a running worker session so blockers or
  feedback can be written back into that session.
- Claude and Gemini reviewers are run in headless prompt mode with `-p` and the
  generated review prompt. Codex reviewers run non-interactively with `codex exec`
  and the prompt as a trailing positional argument; bare `codex` is the
  interactive TUI and aborts with `stdin is not a terminal` when spawned without a
  real terminal. Custom reviewers receive the prompt on stdin.
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
- Blocking review or feedback is written back into the active worker PTY and submitted
  with the same Enter sequence as terminal input. That status is persisted as
  `feedback_sent` and shown as review feedback in the UI.
- Unknown reviewer output marks the loop `error`.

Key files:

- UI controls and latest run summary: `src/components/TaskWorkspace.tsx`
- Agent-driven `Create PR` prompt: `src/hooks/useApp.ts`
- Board review status label: `src/components/TaskCard.tsx`
- Frontend review-loop loading and event subscription: `src/hooks/useTaskReviewLoop.ts`
- Frontend API: `src/api.ts`
- Backend commands: `start_pair_loop`, `run_pair_review`, `stop_pair_loop`,
  `get_task_review_loop`, `list_task_review_runs`
- Runtime worker: `native/src/sessions/review_loop.rs`
- Persistence: `review_loops` and `review_runs` tables
- Persistence API: `native/src/db/review_loops.rs`

## PR Review

PR Review reviews an external GitHub pull request against a known local project and
produces a Markdown review to copy back to the author. It is separate from the task
board: reviews have their own sidebar section and lifecycle, and share the worktree,
reviewer-launch, and notification machinery under the hood.

Current behavior:

- Open the PR Reviews section from the sidebar footer.
- Paste a pull request URL (`https://github.com/owner/repo/pull/123`) and pick a
  reviewer profile, then start the review.
- Nectus resolves the PR's `owner/repo` to a project already added to Nectus by
  matching its git remote (`origin`). If no project matches, the action reports that
  the repository must be added as a project first. No filesystem scanning is done.
- The review runs on a background thread: it fetches PR metadata (`gh pr view`),
  checks out the PR head into an ephemeral worktree
  (`git fetch origin pull/<n>/head` + `git worktree add`), runs the reviewer
  headless in that worktree, stores the Markdown review, and always tears the
  worktree down.
- Status flows `queued → reviewing → ready`, or `error` on failure. A macOS
  notification and in-app toast fire when a review becomes `ready` or `error`.
- The sidebar list groups reviews into three lifecycle sections — **To review**
  (`queued`), **Reviewing** (`reviewing`), and **Done** (`ready` and `error`) —
  each with a count.
- A finished review also carries a `verdict` that the Done badge surfaces:
  **Passed** (no blockers), **Blocking issues**, or **Inconclusive** (the reviewer
  finished without a recognizable verdict). An `error` review shows **Error**
  instead and has no verdict. The verdict comes from a machine-readable
  `NECTUS_PR_VERDICT: BLOCKERS|CLEAN` line the reviewer appends; the backend parses
  it and strips that line before storing the review, so the copied Markdown stays
  clean. The verdict is the only structured signal — the review body itself is
  free-form GitHub-flavored Markdown, not the `pass`/`needs_changes` markers the
  task [AI Review](#ai-review) loop parses.
- The detail view shows the PR metadata and verdict badge, the review text in a
  scrollable pane, a Copy button, a Re-run action (re-fetches the PR head to pick up
  new commits and clears the prior verdict), and Delete.
- Reviewer profiles are the same agent profiles used elsewhere; the default reviewer
  is the configured default agent profile. Claude and Gemini reviewers run with `-p`;
  Codex reviewers run with `codex exec`; custom reviewers receive the prompt on stdin.

Key files:

- Sidebar nav entry: `src/components/Sidebar.tsx`
- Reviews list and create form: `src/components/ReviewsPage.tsx`
- Review detail and copy: `src/components/PrReviewDetail.tsx`
- Frontend state, events, and notifications: `src/hooks/usePrReviews.ts`
- Frontend API: `src/api.ts`
- PR URL parsing and `gh pr view` metadata: `native/src/github.rs`
- Remote `owner/repo` parsing, PR-ref fetch, worktree-at-ref: `native/src/git_ops.rs`
- Runtime worker: `native/src/sessions/pr_review.rs`
- Backend commands: `create_pr_review`, `list_pr_reviews`, `get_pr_review`,
  `rerun_pr_review`, `delete_pr_review`
- Persistence: `pr_reviews` table; API in `native/src/db/pr_reviews.rs`

Emitted event:

- `pr_review_updated`

## GitHub

GitHub integration runs through the `gh` CLI, so Nectus stores no tokens. The app
reports connection status, opens pull requests directly for worktree tasks
(capturing the URL onto the task), and shows live PR state and CI checks. Full
behavior lives in [GitHub Integration](github-integration.md).

Key files:

- Task inspector panel: `src/components/GitHubPanel.tsx`
- Settings connection card: `src/components/SettingsPage.tsx`
- Connection and PR-status state: `src/hooks/useGithub.ts`
- gh shell-out and parsing: `native/src/github.rs`
- Backend commands: `github_status`, `create_github_pull_request`,
  `github_pull_request_status`

## JIRA

The JIRA Board is a first-class view (sidebar footer, alongside PR Reviews) backed
by the official Atlassian CLI (`acli`), so Nectus stores no tokens and runs no
OAuth. The board is global and fully UI-driven — **no JQL is typed**: pick a JIRA
project from a dropdown (populated by `acli jira project list`) and toggle filters
(My issues / Hide done / Current sprint). Nectus builds the query behind the scenes
(`jira::build_board_jql`, stored as `jira_board_project` + `jira_filter_*` flags) and
loads work items into **auto-derived columns** grouped by status and ordered by JIRA
status category.

It is a full management surface: drag a card between columns to transition it
(optimistic — reverted if JIRA's workflow rejects the move), and open a card to
change status, assign, or comment. **Create task from this story** opens the task
modal pre-seeded from the story (title, description) with a project selector; the
resulting task↔story link is stored locally on the task (`jira_issue_key/summary/
url`) and never writes back to JIRA. Linked stories appear as a badge on task
cards/rows and a detachable panel in the task inspector, and — the other direction —
each board card lists the tasks attached to that story (agent logo, title, live/
status), each click-through to the dashboard. Full behavior and caveats live in
[JIRA Integration](jira-integration.md).

Key files:

- Board view: `src/components/JiraBoardPage.tsx`
- Work-item dialog: `src/components/JiraWorkItemDialog.tsx`
- Linked-story inspector panel: `src/components/JiraPanel.tsx`
- Board/connection state and columns: `src/hooks/useJira.ts`
- acli shell-out and parsing: `native/src/jira.rs`
- Backend commands: `jira_status`, `jira_list_projects`, `jira_search_board`,
  `jira_get_work_item`, `jira_transition_work_item`, `jira_assign_work_item`,
  `jira_comment_work_item`, `set_task_jira_link`

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
