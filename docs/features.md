# Feature Map

This document maps current Nectus Desktop behavior to the files that own it.

## Navigation And Mission Control

The app shell is a slim icon rail plus a contextual panel, not a full sidebar.

- The icon rail (always visible, 58px) holds Mission Control, Board, JIRA, PR
  Reviews, and Settings. The Mission Control icon carries a badge with the
  cross-project needs-input count.
- Mission Control is the default home: a cross-project, attention-first triage
  inbox. Every task across every project is grouped by who needs you —
  **Needs you → Running → Review → Done → Idle** — and each row carries the
  agent's latest line, elapsed time, and an inline action (Respond / Open /
  Review / PR). Clicking a row opens that task's terminal workspace.
- The Board is per-project. Selecting Board (or a project in the panel) reveals
  the contextual project panel (projects with task counts and a needs-input dot)
  beside the workflow kanban.
- Opening a task replaces the current view with the focused terminal workspace;
  the back affordance returns to Mission Control or the board.

Key files:

- Icon rail: `src/components/IconRail.tsx`
- Contextual project panel: `src/components/ProjectPanel.tsx`
- Mission Control triage: `src/components/MissionControl.tsx`
- Cross-project agent-state model (state, latest line, elapsed):
  `src/lib/agentState.ts`
- App shell composition and view routing: `src/App.tsx`
- Shell, Mission Control, board, and workspace styling: `src/styles/redesign.css`
- View state and orchestration: `src/hooks/useApp.ts`

## Projects

Projects are existing local git repositories. The app validates a selected
folder with git before saving it.

- Frontend entry points: `src/components/ProjectPanel.tsx`, `src/components/IconRail.tsx`, `src/hooks/useApp.ts`
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

- New-task composer (`CreateTaskComposer`, a focused inline view reached from the
  board's New Task action — not a modal): `src/components/CreateTaskModal.tsx`
- Board and drag/drop status updates: `src/components/Workspace.tsx`
- Task card: `src/components/TaskCard.tsx`
- Task-card pointer drag tracking: `src/hooks/useTaskCardPointerDrag.ts`
- Selected-task workspace — horizontal workflow ribbon above the terminal, an
  inline action bar under it, and a calm sectioned facts rail (identity ·
  metadata · PR-status card · linked story · review): `src/components/TaskWorkspace.tsx`
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
- Selecting a task replaces the current view with a focused terminal workspace.
  Running sessions render the live terminal front and center; tasks without an
  active session show launcher controls in the terminal stage. When the agent is
  waiting, an inline action bar surfaces the pending decision under the terminal.
- There is no task tree in the shell. Cross-project tasks are triaged in Mission
  Control; per-project tasks live on the board. See
  [Navigation And Mission Control](#navigation-and-mission-control).
- Task metadata, status, deletion, prompt, workflow, review controls, and review
  feedback live in the persistent right inspector rail.
- Terminal output is streamed through the `session_output` Tauri event.
- Recent terminal output is buffered in memory for snapshot restore.
- Closing the app stops owned sessions and clears active session ids.

Key files:

- Shell (icon rail + project panel): `src/components/IconRail.tsx`, `src/components/ProjectPanel.tsx`
- Cross-project triage: `src/components/MissionControl.tsx`
- App shell and view routing: `src/App.tsx`
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

## Task Diff

The task workspace stage has a `Terminal | Diff` segmented control, so you can see
what an agent changed without leaving the app. The Diff tab carries a changed-file
count badge and a refresh control.

Current behavior:

- The diff shown is the **full task diff**: for a worktree task it compares the
  branch against the base branch — the merge-base of the repo's default branch
  (`origin/HEAD`), resolved entirely from local refs (no network) — and includes
  both committed and uncommitted changes, the same set the eventual PR carries. A
  direct-edit task has no dedicated branch, so it falls back to the working tree vs
  `HEAD`. The base label (e.g. `origin/main`) is shown above the file list.
- The view is master-detail: a left list of changed files (status glyph · path ·
  `+a −d`), and a right unified-diff pane for the selected file. The first file is
  auto-selected; patch bodies are lazy-loaded per file so a large refactor diff
  stays cheap. Untracked files appear as new files; binary files show
  "Binary file" instead of a patch.
- The summary loads when the Diff tab is shown and on its refresh control, and it
  re-loads automatically when the task's agent finishes a turn (`session_idle`), so
  the diff stays current while the agent works.
- Rename detection is disabled, so a rename shows as a delete + add pair.

Key files:

- Stage toggle + diff mounting: `src/components/TaskWorkspace.tsx`
- Diff view (file list + unified patch, line colorization): `src/components/TaskDiffView.tsx`
- Diff styling: `src/styles/diff.css`
- Diff data hook (summary load, lazy per-file patches, idle refresh): `src/hooks/useTaskDiff.ts`
- Frontend API: `src/api.ts`
- Backend commands: `task_diff_summary`, `task_diff_file`
- Git diff helpers (base resolution, numstat/name-status parsing, untracked patches): `native/src/git_ops.rs`

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
- Counts are shown as Mission Control summary pills and the icon-rail needs-input
  badge.
- macOS notifications are sent for idle and needs-input events when permission is
  granted.
- The matching in-app toast for a known task carries an **Open task** action that
  focuses that task's workspace (selecting its repo and switching to the board
  view when needed). The macOS notification itself cannot be made clickable on
  desktop — the notification plugin's desktop `show()` is fire-and-forget and its
  `onAction` listener is mobile-only — so the toast is the navigable surface.
  Events that cannot be matched to a loaded task fall back to a plain toast.

Key files:

- Attention model: `src/sessionAttention.ts`
- Notification wrapper: `src/sessionNotifications.ts`
- Task toast payload builders: `src/taskNotification.ts`
- Clickable toast hook: `src/hooks/useTaskNotificationToast.ts`
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
board: reviews have their own rail section and lifecycle, and share the worktree,
reviewer-launch, and notification machinery under the hood.

Current behavior:

- Open PR Reviews from the icon rail.
- Paste a pull request URL (`https://github.com/owner/repo/pull/123`) and pick a
  reviewer profile (shown as selectable chips), then start the review. Selecting
  **two or more** reviewers runs a multi-model **consensus** review (see below).
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
- The list groups reviews into three lifecycle sections — **To review**
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

**Consensus mode.** Selecting two or more reviewers (optionally setting a round
count, 1–5, default 3) runs them as a consensus review:

- The PR head is checked out once and every reviewer reads it in round 1. From
  round 2 on, each reviewer also sees the other reviewers' prior-round notes and
  gives a fresh verdict, so they can converge.
- Reviewing stops early the moment all reviewers agree on a recognizable verdict
  (`passed`/`blockers`); otherwise it runs the full round budget.
- The **synthesizer** (the first-selected reviewer) folds every reviewer's latest
  review into one consolidated Markdown review. The stored `verdict` is the
  synthesizer's marker, falling back to the majority position (blockers wins ties).
- The detail view shows a convergence banner ("Converged in N rounds — …"), a
  **reviewers × rounds** matrix of verdict dots that fills in live as each round
  is persisted, and the synthesized review. The list card and detail header carry
  an "N-model" tag.
- Consensus state lives in the data model: the `pr_reviews` row carries `mode`,
  `max_rounds`, `rounds_completed`, and `converged`; the participating reviewers
  live in `pr_review_reviewers`, and each reviewer's per-round verdict + output in
  `pr_review_runs`. A single-reviewer review is `mode = 'single'` with no
  reviewers/runs. The detail matrix is built on the frontend by bucketing
  `list_pr_review_runs` by round. Re-run clears the runs but keeps the reviewer
  roster and round budget.

Key files:

- Rail nav entry: `src/components/IconRail.tsx`
- Reviews list and create form (reviewer chips + consensus rounds): `src/components/ReviewsPage.tsx`
- Review detail, copy, and consensus banner/convergence matrix: `src/components/PrReviewDetail.tsx`
- Frontend state, events, and notifications: `src/hooks/usePrReviews.ts`
- Frontend API: `src/api.ts`
- PR URL parsing and `gh pr view` metadata: `native/src/github.rs`
- Remote `owner/repo` parsing, PR-ref fetch, worktree-at-ref: `native/src/git_ops.rs`
- Single-review runtime worker: `native/src/sessions/pr_review.rs`
- Consensus runtime (parallel rounds in one shared worktree, cross-pollination,
  convergence, synthesizer): `native/src/sessions/pr_consensus.rs`
- Backend commands: `create_pr_review` (takes `reviewerProfileIds` + `maxRounds`),
  `list_pr_reviews`, `get_pr_review`, `list_pr_review_runs`, `rerun_pr_review`,
  `delete_pr_review`
- Persistence: `pr_reviews` (with `mode`, `max_rounds`, `rounds_completed`,
  `converged`), plus `pr_review_reviewers` and `pr_review_runs`; API in
  `native/src/db/pr_reviews.rs`

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

The JIRA Board is a first-class view (icon rail, alongside PR Reviews) backed
by the official Atlassian CLI (`acli`), so Nectus stores no tokens and runs no
OAuth. The board is global and fully UI-driven — **no JQL is typed**: pick a JIRA
project from a dropdown (populated by `acli jira project list`) and toggle filters
(My issues / Hide done / Current sprint). Nectus builds the query behind the scenes
(`jira::build_board_jql`, stored as `jira_board_project` + `jira_filter_*` flags) and
loads work items into **auto-derived columns** grouped by status and ordered by JIRA
status category.

It is a full management surface: drag a card between columns to transition it
(optimistic — reverted if JIRA's workflow rejects the move), and open a card to
dock an **inline side panel** beside the board (the board stays in context as a
2-column split; it is no longer a modal dialog) to change status, assign, or
comment. The panel's bottom launch row (agent select + **Create task & start**)
and the card's **Create task** affordance both open the task composer pre-seeded
from the story (title, description) with a project selector; the resulting
task↔story link is stored locally on the task (`jira_issue_key/summary/url`) and
never writes back to JIRA. Linked stories appear as a badge on task
cards/rows and a detachable panel in the task inspector, and — the other direction —
each board card lists the tasks attached to that story (agent logo, title, live/
status), each click-through opening that task. Full behavior and caveats live in
[JIRA Integration](jira-integration.md).

Key files:

- Board view + docked work-item split: `src/components/JiraBoardPage.tsx`
- Work-item side panel (`JiraWorkItemPanel`, de-modaled): `src/components/JiraWorkItemDialog.tsx`
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
