# Feature Map

This document maps current Nectus Desktop behavior to the files that own it.

## Navigation And Mission Control

The app shell is an always-expanded labeled sidebar plus a persistent navigator panel.

- The sidebar (always visible, ~212px, icon + label rows under a brand wordmark)
  holds Mission Control, Board, JIRA, PR Reviews, and Settings. The Mission
  Control row carries a badge with the cross-project needs-input count.
- A **New task** button sits at the sidebar's foot (a muted bordered create row,
  distinct from the ghost nav rows above), so the New Task composer is reachable
  from any view — including an open task's terminal, where the navigator panel is
  hidden. It opens the same composer as the board's "New Task", defaulting to the
  selected repo (or the first repo in the focused workspace), and is disabled
  until at least one project is added.
- A **persistent navigator panel** sits to the right of the icon rail whenever
  Mission Control, the project board, or the workspace board is the active view
  (it is hidden when a task workspace, the New Task composer, or the workspace
  manager is open). The panel has two sections:
  - **Projects** — one row per local git project; clicking opens that project's
    board. Each row shows the project name, a state dot (color-coded by the most
    urgent in-flight state: needs_you → running → review), and an agent count.
    Each in-flight agent (Needs you / Running / Review; Done/Idle excluded) is
    nested inline under its project row as a compact card showing the agent logo,
    branch, latest line, elapsed time, and a click-to-focus action.
  - **Workspaces** — one row per workspace; clicking opens an **aggregated
    kanban** across all of that workspace's repos (the `workspace` view, reusing
    `Workspace.tsx`). Task cards on the workspace board carry a repo-name badge so
    cards from different repos are distinguishable. Each workspace row has an **ⓘ
    info card** (a popover, `src/components/ui/popover.tsx`) that lists the
    workspace's member projects; each listed project is clickable to open its
    individual board. In-flight agents from all of the workspace's repos are
    nested inline under the workspace row, using the same compact card.
- Mission Control is the default home: a cross-project, attention-first triage
  inbox. Every task across every project is grouped by who needs you —
  **Needs you → Running → Review → Done → Idle** — and each row carries the
  agent's latest line, elapsed time, and an inline action (Respond / Open /
  Review / PR). Clicking a row opens that task's terminal workspace. Mission
  Control always shows all projects; the old workspace scope-switcher has been
  retired.
- Opening a task replaces the current view with the focused terminal workspace;
  the back affordance returns to Mission Control, the project board, or the
  workspace board.

Key files:

- Icon rail: `src/components/IconRail.tsx`
- Persistent navigator panel (Projects + Workspaces, nested agents, info card):
  `src/components/ProjectPanel.tsx`
- Compact nested agent row: `src/components/SidebarAgentRow.tsx`
- Active-agent grouping helper (by repo and by workspace): `src/lib/sidebarAgents.ts`
- Mission Control triage: `src/components/MissionControl.tsx`
- Cross-project agent-state model (state, latest line, elapsed):
  `src/lib/agentState.ts`
- App shell composition and view routing (`mission` | `board` | `workspace` |
  `jira` | `reviews` | `settings`): `src/App.tsx`
- Project board and workspace board (shared kanban, `workspaceName` + `repoNames`
  props for the workspace mode): `src/components/Workspace.tsx`
- Shell, Mission Control, board, and workspace styling: `src/styles/redesign.css`
- View state and orchestration: `src/hooks/useApp.ts`

## Projects

Projects are existing local git repositories. The app validates a selected
folder with git before saving it.

- Frontend entry points: `src/components/ProjectPanel.tsx` (navigator panel), `src/components/IconRail.tsx`, `src/hooks/useApp.ts`
- Dialog wrapper: `src/api.ts`
- Backend command: `add_repo`
- Git validation: `native/src/git_ops.rs`
- Persistence: `repos` table in `native/src/db/schema.rs`

Adding the same project path again updates the existing row instead of creating
a duplicate.

## Workspaces

A workspace is a durable, named group of repos (VSCode-workspace style) for when
you work across several projects at once. Selecting a workspace opens an
**aggregated kanban board** (`currentView = "workspace"`) showing all tasks from
every repo in that workspace; task cards display a repo-name badge to tell them
apart. Mission Control always shows every project regardless of the focused
workspace — the old workspace scope-filter and "All repos" switcher have been
retired. A repo can belong to more than one workspace.

- Workspaces appear in the **Workspaces section** of the persistent navigator
  panel (`src/components/ProjectPanel.tsx`); clicking a row opens the aggregated
  board and focuses that workspace (`openWorkspaceBoard` in `useApp.ts`). Each
  workspace row shows a state dot and inline nested-agent cards covering its
  member repos, and an ⓘ info card listing its projects.
- The **workspace manager** is a de-modaled inline composer (matching New Task)
  to create, rename, re-scope, and delete workspaces with a per-repo checklist;
  opened via the "Manage" button in the panel header.
- The focused workspace (the one whose board is open) is used to pre-populate
  the New Task composer's cross-repo Repositories checklist; navigating away via
  the icon rail clears the focus. Focus is in-memory (not persisted across
  launches); the workspaces and their membership are persisted.

Key files:

- Navigator panel (Workspaces section): `src/components/ProjectPanel.tsx`
- Manager: `src/components/WorkspaceManager.tsx`
- Aggregated workspace board: `src/components/Workspace.tsx` (receives
  `workspaceName` + `repoNames` props when in workspace mode)
- State, focused workspace, `workspaceBoardTasks`, `openWorkspaceBoard`, and
  CRUD: `src/hooks/useApp.ts`
- Backend commands: `list_workspaces`, `create_workspace`, `update_workspace`,
  `delete_workspace`
- Persistence: `workspaces` + `workspace_repos` tables (`native/src/db/schema.rs`,
  `native/src/db/workspaces.rs`)

### Cross-repo tasks

A task created while a workspace is active can span **several of the workspace's
repos**, driven by a single agent. In the New Task composer the Project dropdown
becomes a **Repositories checklist** (the workspace's repos, all pre-selected); the
first selected repo is the primary. Picking two or more creates a cross-repo task.

- Each repo gets its own worktree on a **shared branch**, laid out as siblings under
  one parent: `<…/.nectus/worktrees>/workspaces/<branch>/<repoName>` (sibling
  folders are disambiguated by id when two repos share a directory name).
- A **single agent session** runs in the primary repo's worktree; the other repos
  are reachable as siblings at `../<repoName>`. The task prompt is prefixed with this
  layout so the agent has cross-repo context. Each repo keeps its own branch.
- The task inspector lists every repo (branch + dirty indicator, primary marked).
  Deleting the task removes **all** its worktrees; with uncommitted work in any of
  them the delete is refused until confirmed (then force-removes all).
- Per-repo state lives in the `task_repos` table; a single-repo task is the N=1 case
  (one row mirroring the task). `tasks.repo_id` is the primary repo.

Current scope: the Diff tab and GitHub PR panel operate on the **primary** repo's
worktree for a cross-repo task. Per-repo diffs and per-repo PRs are a planned
follow-up; see `docs/superpowers/specs/2026-06-06-multi-repo-workspaces-design.md`.

Key files: `create_cross_repo_task` (`native/src/db/tasks.rs`, command in
`native/src/lib.rs`), the `task_repos` table (`native/src/db/schema.rs`), the
composer's multi-repo mode (`src/components/CreateTaskModal.tsx`), the create flow
(`src/hooks/useApp.ts`), and the inspector repo list
(`src/components/taskWorkspace/TaskWorkspaceFactsRail.tsx`).

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
- Create the worktree path from the project worktree root pattern (default `~/.nectus/worktrees/<repo-name>/<branch-name>`).
- Run the agent in that worktree path.
- Remove the git worktree when the task is deleted. A worktree with uncommitted
  changes is not silently discarded: the delete dialog warns that the changes
  will be lost and only then force-removes it; a clean worktree is removed
  normally.
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
- OpenCode: `opencode`

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
as Codex app bundle resource paths and OpenCode installs under
`~/.opencode/bin/opencode` or `~/bin/opencode`.

## Sessions And Terminal

Sessions are app-owned child processes attached to an embedded PTY.

Current behavior:

- A task can have only one active session.
- Direct-edit tasks launch in the project path.
- Worktree-backed tasks launch in the worktree path.
- New task prompts are written to the PTY after launch. OpenCode is the exception:
  its initial task prompt is passed through `opencode --prompt`, so Nectus skips the
  post-spawn PTY write to avoid a duplicate prompt.
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
- A running task's card and Mission Control row show a live "what it's doing"
  line between the title and branch: the latest readable line of the agent's
  terminal output (ANSI-stripped, throttled, de-duplicated) carried by the
  `session_activity` event. It falls back to "Working…" before the first line
  and clears when the session exits.
- Closing the app stops owned sessions and clears active session ids.

Key files:

- Shell (icon rail + navigator panel): `src/components/IconRail.tsx`, `src/components/ProjectPanel.tsx`
- Cross-project triage: `src/components/MissionControl.tsx`
- App shell and view routing: `src/App.tsx`
- Terminal UI: `src/TerminalPane.tsx`
- Session controls: `src/hooks/useSessionCommands.ts`
- Attention-clearing session control wrappers: `src/hooks/useSessionAttentionControls.ts`
- Backend command registration: `native/src/lib.rs`
- PTY lifecycle: `native/src/sessions/mod.rs`

Emitted events:

- `session_output`
- `session_activity`
- `session_exited`
- `session_idle`
- `session_needs_input`
- `review_loop_updated`

## Task Diff

The task workspace stage has a `Terminal | Diff | Review` segmented control, so you
can see what an agent changed without leaving the app. The stage header carries a
changed-file count badge and `+a −d` line totals next to the toggle (visible on all
tabs), the Diff tab adds a manual refresh control, and the Review tab is covered in
[AI Review](#ai-review).

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
- The summary loads as soon as a task is selected, so the count/line-total badge is
  populated without opening the Diff tab first. It also reloads on the Diff tab's
  refresh control and automatically when the task's agent finishes a turn
  (`session_idle`), so the badge stays current while the agent works. Refresh is
  event-driven (selection + turn boundary), not timer-based polling; each refresh is
  a cheap local `git diff` with no network/GitHub call.
- Rename detection is disabled, so a rename shows as a delete + add pair.

Key files:

- Stage toggle + diff mounting: `src/components/TaskWorkspace.tsx`
- Diff view (file list + unified patch, line colorization): `src/components/TaskDiffView.tsx`
- Diff styling: `src/styles/diff.css`
- Diff data hook (summary load on selection, lazy per-file patches, idle refresh): `src/hooks/useTaskDiff.ts`
- Frontend API: `src/api.ts`
- Backend commands: `task_diff_summary`, `task_diff_file`
- Git diff helpers (base resolution, numstat/name-status parsing, untracked patches): `native/src/git_ops.rs`

## Session Resume

Codex, Claude, and OpenCode profiles support resume from a saved session id.

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

OpenCode:

- New sessions launch with a reserved local server:
  `opencode --hostname 127.0.0.1 --port <port> [--model provider/model] [args]
  --prompt <task prompt>`.
- Resume launches with the saved OpenCode id:
  `opencode --hostname 127.0.0.1 --port <port> --session <session-id> [args]`.
- Nectus discovers the OpenCode session from the local server's `/session` API and
  saves the id and label when available.

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
- Claude sessions emit the same two markers through Claude Code hooks instead of
  a rollout JSONL: the `Stop` hook maps to `session_idle` and the `Notification`
  hook maps to `session_needs_input`.
- OpenCode sessions are launched with a local server port. Nectus discovers the
  matching top-level session through `/session`, then subscribes to the server's
  `/event` SSE stream: `session.idle` maps to `session_idle`, and the permission
  and question asks (`permission.asked`, `permission.v2.asked`, `question.asked`,
  `question.v2.asked`) map to `session_needs_input`. Events for subagent sessions
  are ignored.
- Codex, Claude, and OpenCode funnel through the shared `emit_session_signal` in
  `native/src/sessions/mod.rs`.
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
- The toast's icon is the provider logo (Claude/Codex/Gemini/OpenCode, falling
  back to a generic mark for custom agents) so you can tell at a glance which
  agent the update is from. The body text is built by `formatNotificationBody`, which strips
  the Markdown agents emit in their final messages (`**bold**`, `` `code` ``,
  `[text](url)`, bullets/headings) and truncates on a word boundary with a `…`,
  hard-cutting only a single very long token such as a bare URL. The same
  formatter cleans the macOS notification body.

Key files:

- Attention model: `src/sessionAttention.ts`
- Notification wrapper: `src/sessionNotifications.ts`
- Body cleanup + truncation: `src/notificationText.ts`
- Task toast payload builders: `src/taskNotification.ts`
- Clickable toast hook (provider-logo icon): `src/hooks/useTaskNotificationToast.tsx`
- Provider logos: `src/components/AgentBrand.tsx` (`AgentLogo`)
- Event listener hook: `src/hooks/useSessionEvents.ts`
- Codex event source (rollout JSONL): `native/src/sessions/codex.rs`
- Claude event source (Claude Code hook bridge): `native/src/sessions/claude.rs`
- OpenCode event source (local server `/event` SSE stream): `native/src/sessions/opencode.rs`
- Shared signal emission (Codex + Claude + OpenCode): `native/src/sessions/mod.rs`
  (`emit_session_signal`)

## AI Review

AI review is a single reviewer pass over the selected task worktree.

Current behavior:

- Use the task workflow stepper's `Review with <reviewer>` action to run one
  reviewer pass.
- The review action shows the reviewer profile icon and name inline. Use the
  adjacent dropdown to switch reviewer profiles before starting the pass.
- The review action switches the selected task UI to `reviewing` while the reviewer
  command runs, and the task workflow stepper shows the in-progress state.
- The workspace stage has a read-only **Review** tab that streams the reviewer's
  live stdout (`review_output` chunks emitted by `native/src/sessions/review_loop.rs`)
  into an `xterm.js` pane, so you can watch the reviewer inspect the worktree in
  real time. Starting a review auto-selects this tab; the facts-rail review card's
  `Watch live` / `View output` button opens it too. The tab is read-only — there is
  no input, session, or snapshot — and between runs it shows the last recorded
  reviewer output. Reviewer stdout is streamed over a pipe (not a PTY), so a
  reviewer that fully buffers its stdout may not appear until it flushes; `codex
  exec` streams incrementally.
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
  generated review prompt. Codex reviewers run non-interactively with `codex exec`,
  and OpenCode reviewers run with `opencode run`; both receive the prompt as a
  trailing positional argument. Bare `codex` is the interactive TUI and aborts
  with `stdin is not a terminal` when spawned without a real terminal. Custom
  reviewers receive the prompt on stdin.
- **Session resume for reviewers.** Claude, Codex, and OpenCode reviewers resume
  their prior conversation across rounds rather than re-reading the worktree cold:
  - Claude: minted once with `--session-id <uuid>` and resumed with
    `--resume <uuid>` on every subsequent pass.
  - Codex: runs in JSON-event mode (`codex exec --json`); the session id is
    captured from the stream on the first run and resumed with
    `codex exec resume <id> --json`.
  - OpenCode: runs with `--format json`; the id is captured from the stream and
    resumed with `opencode run --session <id> --format json`.
  - Gemini and Custom reviewers have no resume; they review fresh each time.
  - Task-loop ids are stored in `review_loops.reviewer_session_id` (reset when
    the loop is restarted). PR-review ids are stored in
    `pr_reviews.reviewer_session_id` (preserved across reruns). Consensus
    keeps per-reviewer ids in memory for the duration of one run.
  - Side effect: a Codex or OpenCode reviewer's live "Watch reviewer" output
    arrives as one chunk at completion rather than token-by-token, because those
    CLIs emit the full message in a single JSON event in non-interactive mode.
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

- UI controls, stage `Review` tab, and latest run summary: `src/components/TaskWorkspace.tsx`
- Read-only live reviewer terminal: `src/components/ReviewTerminalPane.tsx`
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
  Codex reviewers run with `codex exec`, OpenCode reviewers run with `opencode run`,
  and custom reviewers receive the prompt on stdin.
- **Session resume for PR reviewers.** Claude, Codex, and OpenCode reviewers resume
  their prior session across reruns of the same PR review (the stored id is in
  `pr_reviews.reviewer_session_id`), so repeat reviews build on earlier findings
  rather than re-reading the PR from scratch. Gemini and Custom reviewers always
  review fresh. The live output for Codex/OpenCode PR reviewers arrives in one
  chunk at completion (same JSON-event-mode caveat as the task review loop).
  See the [AI Review](#ai-review) section for per-provider resume mechanics.

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
(capturing the URL onto the task), and shows live PR state and CI checks. A
worktree task's PR can then be **shipped from the inspector** — merge
(squash/merge/rebase, behind a confirm), mark a draft ready, or close — and its
**GitHub Actions / CI checks expand to a per-workflow list** with links straight to
each run. PR status **auto-refreshes** while the PR is open (interval + window
focus) so checks turn green on their own. A finished AI PR review can be **posted
back to the pull request** as a comment. Full behavior lives in
[GitHub Integration](github-integration.md).

Key files:

- Task inspector panel: `src/components/GitHubPanel.tsx` (+ ship actions
  `src/components/github/PullRequestActions.tsx`, CI drill-down
  `src/components/github/PullRequestChecks.tsx`)
- Settings connection card: `src/components/SettingsPage.tsx`
- Connection, PR status, ship actions, and auto-refresh: `src/hooks/useGithub.ts`
- gh shell-out and parsing: `native/src/github.rs`
- Backend commands: `github_status`, `create_github_pull_request`,
  `github_pull_request_status`, `detect_github_pull_request`,
  `merge_github_pull_request`, `set_github_pull_request_ready`,
  `close_github_pull_request`, `post_pr_review_comment`

## JIRA

The JIRA Board is a first-class view (icon rail, alongside PR Reviews) backed
by the official Atlassian CLI (`acli`), so Nectus stores no tokens and runs no
OAuth. The board is global and fully UI-driven — **no JQL is typed**: pick a JIRA
project from a dropdown (populated by `acli jira project list`) and toggle filters
(My issues / Hide done / Current sprint). Nectus builds the query behind the scenes
(`jira::build_board_jql`, stored as `jira_board_project` + `jira_filter_*` flags) and
loads work items into **auto-derived columns** grouped by status and ordered by JIRA
status category.

It is a full management surface: create a new work item, drag a card between
columns to transition it (optimistic — reverted if JIRA's workflow rejects the
move), and open a card to dock an **inline side panel** beside the board (the
board stays in context as a 2-column split; it is no longer a modal dialog) to
change status, assign, or comment. **New work item** in the toolbar opens an
inline create form in that same dock slot (project defaulting to the board's,
type Task/Bug/Story/Epic, summary, description, assignee, labels); on submit
Nectus runs `acli jira workitem create`, refreshes the board, and auto-opens the
new card's view panel — where the launch row can immediately start an agent on
it. The panel's bottom launch row (agent select + **Create task & start**)
and the card's **Create task** affordance both open the task composer pre-seeded
from the story (title, description) with a project selector; the resulting
task↔story link is stored locally on the task (`jira_issue_key/summary/url`) and
never writes back to JIRA. Linked stories appear as a badge on task
cards/rows and a detachable panel in the task inspector, and — the other direction —
each board card lists the tasks attached to that story (agent logo, title, live/
status), each click-through opening that task.

**Custom workflows (optional REST token).** Because `acli` can't enumerate a
project's statuses or an issue's valid transitions, an optional API-token layer
(Settings → JIRA, stored in the macOS Keychain) unlocks custom-workflow support
when connected: the status dropdown shows the issue's **legal transitions**, the
board renders **every status column** (including empty ones), and a **status
filter** in the board header narrows the board. It is additive and off by default —
with no token, the board behaves exactly as the acli-only flow above. Full behavior
and caveats live in [JIRA Integration](jira-integration.md).

Key files:

- Board view + docked work-item split: `src/components/JiraBoardPage.tsx`
- Work-item side panel (`JiraWorkItemPanel`, de-modaled): `src/components/JiraWorkItemDialog.tsx`
- New-work-item create panel (`JiraCreateWorkItemPanel`): `src/components/JiraCreateWorkItemPanel.tsx`
- Linked-story inspector panel: `src/components/JiraPanel.tsx`
- Board/connection state, columns, and create: `src/hooks/useJira.ts`
- acli shell-out and parsing: `native/src/jira.rs`
- Backend commands: `jira_status`, `jira_list_projects`, `jira_search_board`,
  `jira_get_work_item`, `jira_transition_work_item`, `jira_assign_work_item`,
  `jira_comment_work_item`, `jira_create_work_item`, `set_task_jira_link`

## Settings

Settings are persisted locally and include:

- Default agent profile
- Worktree root pattern
- Default branch prefix
- Theme
- Density

The worktree root pattern defaults to `~/.nectus/worktrees/{repoName}` and must
include `{repoName}`; a leading `~` expands to `$HOME`. Existing project rows are
refreshed when the pattern changes. Databases created before this default shipped
are migrated from the legacy sibling layout (`../{repoName}-worktrees`) to the
`~/.nectus` default on open, unless the pattern was customized.
When Theme is set to System, the UI follows OS color-scheme changes while the
app is running.

Key files:

- Settings page composition: `src/components/SettingsPage.tsx`
- Agent profile editor: `src/components/settings/ProfileEditor.tsx`
- Settings draft helpers: `src/components/settings/profileDrafts.ts`
- Theme hook: `src/hooks/useAppTheme.ts`
- Backend commands: `get_app_settings`, `update_app_settings`
- Persistence: `app_settings` table
