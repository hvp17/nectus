# Feature Map

This document describes current Nectus Desktop **feature behavior** — semantics,
flows, and edge cases. It is deliberately not a file index: for which files own a
feature, see the maps in [AGENTS.md](../AGENTS.md) (Backend / Frontend Boundaries);
for how the layers connect, see [architecture.md](architecture.md); for the
authoritative Tauri command/event reference and SQLite tables, see
[tracking-and-debugging.md](tracking-and-debugging.md).

## Navigation And Mission Control

The app shell is an always-collapsed icon rail plus a persistent navigator panel.

- The icon rail (always visible, a narrow 52px icon-only strip under the brand
  "N" mark; the width lives in `AppRouter`'s frame grid) holds Mission Control, Board, JIRA,
  PR Reviews, and Settings. Each button is icon-only with a hover tooltip naming
  it and keeps its `aria-label`; the Mission Control icon carries a corner badge
  with the cross-project needs-input count.
- A **New task** button sits at the rail's foot (a muted bordered icon button),
  so the New Task composer is reachable from any view. It opens the same composer
  as the board's "New Task", defaulting to the selected repo (or the first repo
  in the focused workspace), and is disabled until at least one project is added.
- A **persistent navigator panel** sits to the right of the icon rail whenever
  Mission Control, the project board, the workspace board, **or an open task's
  details** is the active view (it is hidden only when the New Task composer or
  the workspace manager is open). The panel has two sections:
  - **Projects** — one row per local git project; clicking opens that project's
    board. Each row shows the project name, a state dot (color-coded by the most
    urgent in-flight state: needs_you → running → review), and an agent count. A
    hover-revealed **"+"** at the row's right edge opens the New Task composer
    preselected to that project (Project mode). Each in-flight agent (Needs you /
    Running / Review; Done/Idle excluded) is nested inline under its project row as
    a compact card showing the agent logo, branch, latest line, elapsed time, and a
    click-to-focus action. A hover **⋯ menu** on each project row offers
    **Rename project** (display name only; the path and worktree root are
    untouched) and **Remove project** — local bookkeeping only: the backend
    refuses while any task still references the repo, and the repository on
    disk is never touched.
  - **Workspaces** — one row per workspace; clicking opens an **aggregated
    kanban** across all of that workspace's repos (the `workspace` view, reusing
    `Workspace.tsx`). Task cards on the workspace board carry a repo-name badge so
    cards from different repos are distinguishable; a cross-repo task's badge
    appends `+N` for its additional repos (the tooltip lists them all). The
    section header has a **"+"** (like the Projects section) that opens the
    workspace manager. Each workspace row has an **ⓘ
    info card** (a popover, `src/components/ui/popover.tsx`) that lists the
    workspace's member projects; each listed project is clickable to open its
    individual board. A hover-revealed **"+"** at the row's right edge opens the
    New Task composer preselected to that workspace — in cross-repo (Workspace)
    mode when it resolves to ≥2 known repos, otherwise single-repo Project mode on
    its sole member. In-flight agents from all of the workspace's repos are nested
    inline under the workspace row, using the same compact card.
  - **Collapsing rows** — any project or workspace row that has nested agents shows
    a leading disclosure **chevron** that folds its agent list away; the row, its
    state dot, and its count stay visible. The fold is per-row and persisted
    (`repos.collapsed` / `workspaces.collapsed`), so it survives reloads. Rows with
    no in-flight agents have nothing to fold and show no chevron.
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

The shell composes the icon rail and navigator panel around a selected leaf view.
The active view (`mission` | `board` | `workspace` | `jira` | `reviews` |
`settings`) is driven by the store and rendered by `AppRouter`'s plain switch. The
project board and workspace board are the same kanban component, switched into
workspace mode with `workspaceName` + `repoNames` props.

File ownership: see the maps in [AGENTS.md](../AGENTS.md); for how the shell, store,
queries, and command boundary connect, see [architecture.md](architecture.md).

## Projects

Projects are existing local git repositories. The app validates a selected
folder with git (in `native/src/git_ops/`) before saving it through the `add_repo`
command.

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
  panel; clicking a row opens the aggregated board and focuses that workspace. Each
  workspace row shows a state dot and inline nested-agent cards covering its
  member repos, and an ⓘ info card listing its projects.
- The **workspace manager** is a de-modaled inline composer (matching New Task)
  to create, rename, re-scope, and delete workspaces with a per-repo checklist;
  opened via the "Manage" button in the panel header.
- The focused workspace (the one whose board is open) is used to pre-populate
  the New Task composer's cross-repo Repositories checklist; navigating away via
  the icon rail clears the focus. Focus is in-memory (not persisted across
  launches). If the composer opens before workspace membership has hydrated, it
  seeds the checklist once that focused workspace becomes available. The workspaces
  and their membership are persisted (`workspaces` + `workspace_repos` tables).

### Cross-repo tasks

A task can span **several of a workspace's repos**, driven by a single agent. The
New Task composer carries a **Project / Workspace scope toggle** (shown only when at
least one workspace resolves to ≥2 repos). In **Project** scope it shows the single
Project dropdown; in **Workspace** scope it shows a **Workspace dropdown** plus a
**Repositories checklist** (the chosen workspace's repos, all pre-selected, first =
primary). Picking two or more repos creates a cross-repo task. The toggle defaults to
Workspace when opened from a focused workspace board and to Project everywhere else,
so a cross-repo task can be started from any entry point — not only a workspace board.

- Each repo gets its own worktree on a **shared branch**, laid out as siblings under
  one parent: `<…/.nectus/worktrees>/workspaces/<branch>/<repoName>` (sibling
  folders are disambiguated by id when two repos share a directory name). The
  per-repo worktrees are created **concurrently**, so a cross-repo task costs about
  one repo's setup time, not the sum.
- A **single agent session** runs in the primary repo's worktree; the other repos
  are reachable as siblings at `../<repoName>`. The task prompt is prefixed with this
  layout so the agent has cross-repo context. Each repo keeps its own branch.
- The task inspector lists every repo (branch + dirty indicator, primary marked).
  Deleting the task removes **all** its worktrees; with uncommitted work in any of
  them the delete is refused until confirmed (then force-removes all).
- Per-repo state lives in the `task_repos` table; a single-repo task is the N=1 case
  (one row mirroring the task). `tasks.repo_id` is the primary repo.

**Worktree-creation latency & progress.** Creating a worktree-backed task fetches
the latest default branch from the remote, which dominates creation time on large
repos. It is tuned to stay fast: the default branch is read from the local
`origin/HEAD` symref (no network round trip) and the fetch pulls only that branch
without tags, instead of every ref; cross-repo tasks fetch all repos concurrently.
While this runs, the composer shows a live status — "Setting up worktree (fetching
latest)…" then "Starting agent…" — instead of a blank spinner, and the full
backend step timing is visible in Settings → Diagnostics.

The Diff tab and GitHub PR panel are **per-repo** for a cross-repo task: a
shared member-repo picker (in the diff toolbar and the GitHub panel header)
scopes both surfaces to any of the task's repos. The primary repo's PR lives on
the task (`tasks.pr_url`); a non-primary member's detected PR is backfilled
onto its `task_repos.pr_url` row. Ship actions (create/merge/ready/close)
submitted while a non-primary repo is scoped instruct the agent to run inside
that repo's sibling worktree.

The fan-out lives in the `create_cross_repo_task` backend flow, with per-repo state
in the `task_repos` child table. File ownership: see [AGENTS.md](../AGENTS.md).

## Tasks

Task is the primary work item. A task can be direct-edit or worktree-backed.

**Archive**: a done task can be archived (facts-rail button; refused while a
session is running). Archived tasks vanish from every live surface — boards,
Mission Control, the sidebar — and from the per-worktree dirty checks, but keep
their row, worktree, and branch until deleted. Both boards have an **Archived**
toggle showing the read-only archive view, where cards offer **Restore** and
**Delete** (archived cards do not open the task workspace).

**Persistent sessions** (Settings → Projects & Worktrees, default off): when
enabled and `tmux` ≥ 3.2 is installed, agent sessions run inside a dedicated
tmux server (`tmux -L nectus`, isolated from any tmux you run yourself). The
app's embedded terminal is then a tmux client: quitting the app leaves agents
running, and the next launch reattaches their terminals automatically (sessions
whose task was deleted in between are killed). **Stop** still stops the agent
for real. OpenCode reattaches without its event watcher (its per-launch local
server port does not survive a restart), so idle/needs-input detection for
OpenCode resumes on the next fresh start; Codex and Claude watchers reattach
fully. Without tmux installed the setting falls back to normal sessions with a
logged warning.

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

The new-task composer is a focused inline view reached from the board's New Task
action (not a modal). The board supports drag/drop status updates. The selected-task
workspace shows a horizontal workflow ribbon above the terminal, an inline action bar
under it, and a calm sectioned facts rail (identity · metadata · PR-status card ·
linked story · review). The workspace header title is **click-to-edit** (a pencil
appears on hover): Enter or blur saves a trimmed, changed title via
`update_task_metadata`, Escape reverts.

Opening the composer resolves the draft agent against loaded agent profiles, keeping
a valid existing draft choice when possible and falling back to the configured
default or selected profile so stale profile ids are not submitted.

File ownership: see [AGENTS.md](../AGENTS.md).

## Agent Profiles

Agent profiles describe which CLI command to run and how to run it.

Seeded profiles:

- Codex: `codex`
- Claude: `claude`
- Antigravity: `agy` (Google's successor to the retired Gemini CLI)
- OpenCode: `opencode`

Profiles can also be customized with:

- Name
- Agent kind
- Command
- Model
- Extra args, one per line
- Environment variables as `KEY=value`

Command resolution checks PATH first, then common user binary locations.
Provider modules own command arguments and app-specific fallback locations, such
as Codex app bundle resource paths and OpenCode installs under
`~/.opencode/bin/opencode` or `~/bin/opencode`.

File ownership: see [AGENTS.md](../AGENTS.md).

## Sessions And Terminal

Sessions are app-owned child processes attached to an embedded PTY.

Current behavior:

- A task can have only one active session.
- Direct-edit tasks launch in the project path.
- Worktree-backed tasks launch in the worktree path.
- Starting a session requires at least one agent profile; if none exists, the app
  shows guidance to add one in Settings instead of silently ignoring the launch.
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
  line between the title and branch, carried by the `session_activity` event
  (throttled, de-duplicated). For Codex, Claude, and OpenCode it is parsed from
  the provider's structured event stream (Codex reasoning/messages, Claude
  `PreToolUse` tool-use hook, OpenCode message parts), so it reads as real
  progress ("Editing App.tsx", "Running npm test") instead of statusline chrome
  or echoed keystrokes; Antigravity and custom agents fall back to an ANSI-stripped
  tail of the PTY output. It falls back to "Working…" before the first line and
  clears when the session exits.
- Closing the app stops owned sessions and clears active session ids.

Sessions emit these Tauri events: `session_output` (terminal stream),
`session_activity` (the live "what it's doing" line), `session_exited`,
`session_idle`, and `session_needs_input`. (Review-loop events are listed under
[AI Review](#ai-review).)

File ownership and the authoritative command/event catalog: see
[AGENTS.md](../AGENTS.md) and [tracking-and-debugging.md](tracking-and-debugging.md).

## Embedded Agent Chat

The task workspace also has a **Chat** tab that drives ACP-capable agent CLIs
through the Agent Client Protocol instead of through a raw terminal TUI.

Current behavior:

- Chat is available from the task workspace stage alongside Terminal, Diff, and
  Review.
- On the first prompt, Nectus starts an ACP session for the task's agent profile
  in the task worktree (or project path for direct-edit tasks). It streams the
  normalized ACP updates into the transcript and persists settled user/agent
  turns in SQLite.
- ACP launch is driven by the Rust provider descriptor in `native/src/sessions/acp.rs`
  for Claude Code, OpenCode, Codex, and Antigravity (preview). The runtime resolves the descriptor's
  command, seeds the login-shell environment, adds the augmented PATH, applies any
  provider-specific executable override, then applies the selected profile's env
  last so per-profile keys and PATH override the defaults.
- The same descriptor is exported through `list_acp_providers`, including stable
  provider ids, launch argv, and coarse capability states (`expected`, `unknown`,
  or `unsupported`) for resume, permission, and image support. Runtime ACP
  `initialize` remains authoritative for `session/load`.
- The Chat tab uses that descriptor export to gate launch and offers a compact
  chat-agent selector populated from the task's agent profiles. Transcript reads
  (`get_task_chat`) and live `session_chat` cache updates are scoped to the
  selected profile's latest session. Switching from one ACP-capable profile to
  another starts a new chat row for the selected profile rather than sending into
  a transcript owned by a different agent. If the selected profile has no ACP
  provider descriptor yet (for example Antigravity or a custom profile), the
  composer is disabled with an inline callout that points the user back to the
  Terminal tab.
- The transcript renders structured parts: text, reasoning, tool cards, file-edit
  chips, permission requests, and plan entries. Permission cards support allow/reject
  once or always; "always" choices persist in `chat_permission_policies` and are
  auto-applied on future matching tool titles. File chips switch the workspace to
  the Diff tab and select the matching changed file so its patch loads immediately.
- After each settled agent turn, Nectus snapshots `git rev-parse HEAD` into
  `chat_checkpoints`. The Chat tab exposes a Checkpoints menu to restore a prior
  turn with `git reset --hard` in the task worktree.
- The composer queues follow-up prompts on the live ACP connection (serial user/agent
  turns). When the agent emits usage updates, the Chat tab shows context-window %.
  Image attach is available when the provider descriptor advertises image support.
- A **Resumable** badge appears when the persisted row has an `acp_session_id` and
  the provider supports `session/load`.
- If the app reloads with a persisted chat session whose ACP process is no longer
  live, sending a message starts the ACP process again. When the persisted row
  has an agent `acp_session_id` and the agent advertises ACP `loadSession`,
  Nectus calls `session/load` so the CLI resumes that conversation; otherwise it
  starts a fresh ACP session and resends the prompt rather than leaving the
  composer stuck on "No such chat session".
- Retired Gemini profile rows are treated as Antigravity when read, matching the
  startup migration from `agent_kind = 'gemini'` to `antigravity`.

The chat surface is served by `list_acp_providers`, `get_task_chat`, `acp_start_chat`,
`acp_send_prompt` (optional image attachments), `acp_respond_permission`,
`acp_stop_chat`, `list_chat_permission_policies`, `clear_chat_permission_policies`,
`list_chat_checkpoints`, and `restore_chat_checkpoint`; live updates arrive on
`session_chat` and `session_chat_usage`. Settings → Diagnostics lists saved
permission policies. File ownership: see [AGENTS.md](../AGENTS.md).

## Task Diff

The task workspace stage has a `Terminal | Diff | Review | Chat` segmented control,
so you can see what an agent changed or talk to it without leaving the app. The stage header carries a
changed-file count badge and `+a −d` line totals next to the toggle (visible on all
tabs), the Diff tab adds a manual refresh control, and the Review tab is covered in
[AI Review](#ai-review). The Chat tab is covered in
[Embedded Agent Chat](#embedded-agent-chat).

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
- Rename detection is disabled (`--no-renames`), so a rename shows as a delete + add
  pair.

The diff is served by the `task_diff_summary` / `task_diff_file` commands; base
resolution, numstat/name-status parsing, and untracked patches live in
`native/src/git_ops/diff.rs`. File ownership: see [AGENTS.md](../AGENTS.md).

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

Resume is disabled for Antigravity and custom profiles unless their behavior is added
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
- The toast's icon is the provider logo (Claude/Codex/Antigravity/OpenCode, falling
  back to a generic mark for custom agents) so you can tell at a glance which
  agent the update is from. The body text is built by `formatNotificationBody`, which strips
  the Markdown agents emit in their final messages (`**bold**`, `` `code` ``,
  `[text](url)`, bullets/headings) and truncates on a word boundary with a `…`,
  hard-cutting only a single very long token such as a bare URL. The same
  formatter cleans the macOS notification body.

Session/review/PR events are subscribed once in the mount-once event bridge and
routed to the query cache or the UI store; the per-provider event sources are the
Codex rollout JSONL (`native/src/sessions/codex.rs`), the Claude Code hook bridge
(`native/src/sessions/claude.rs`), and the OpenCode `/event` SSE stream
(`native/src/sessions/opencode.rs`), all funneling through `emit_session_signal` in
`native/src/sessions/mod.rs`. File ownership: see [AGENTS.md](../AGENTS.md).

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
  GitHub CLI is connected. Creating a PR — and merge / mark-ready / close — are all
  **agent-driven**: the action submits a prompt into the task's running agent
  session (the agent commits/pushes, authors the PR title and description itself,
  opens the PR, and for merge rebases/resolves conflicts as needed). A write action
  needs a running session; with none it declines with guidance to start or resume
  the agent. PR detection and live status stay deterministic `gh` reads. See
  [GitHub Integration](github-integration.md).
- The task workflow stepper also shows a `Move to done` step that marks the
  task complete.
- PR URLs are stored on the task: captured automatically by the `gh`-driven flow,
  or written through task metadata when linked manually or by the agent.
- Manual review runs require a running worker session so blockers or
  feedback can be written back into that session.
- Claude and Antigravity reviewers are run in headless prompt mode with `-p` and the
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
  - Antigravity and Custom reviewers have no resume; they review fresh each time.
  - Task-loop ids are stored in `review_loops.reviewer_session_id` (reset when
    the loop is restarted). PR-review ids are stored in
    `pr_reviews.reviewer_session_id` (preserved across reruns). Consensus
    keeps per-reviewer ids in memory for the duration of one run.
  - Side effect: a Codex or OpenCode reviewer's live "Watch reviewer" output
    arrives as one chunk at completion rather than token-by-token, because those
    CLIs emit the full message in a single JSON event in non-interactive mode.
- Reviewer output is parsed from the shared `NECTUS_VERDICT:` marker line (the same
  contract the PR reviews use, in `native/src/sessions/verdict.rs`); the marker line
  is stripped from what is stored and forwarded to the worker:
  - `pass` ← `NECTUS_VERDICT: CLEAN`
  - `needs_changes` ← `NECTUS_VERDICT: BLOCKERS`
  - `feedback` ← `NECTUS_VERDICT: FEEDBACK`
  - `unknown` when no marker is present (there is no natural-language fallback — a
    review that merely quotes a phrase like "blocking issue" is not classified).
- Passing review marks the loop `passed` and moves the task to `done`.
- Task cards show the saved review status once a review exists, including
  completed `Review passed` state.
- Blocking review or feedback is written back into the active worker PTY and submitted
  with the same Enter sequence as terminal input. That status is persisted as
  `feedback_sent` and shown as review feedback in the UI.
- Unknown reviewer output marks the loop `error`.

The review-loop runtime emits two Tauri events: `review_loop_updated` (loop/run
state changes, routed to the query cache) and `review_output` (the live reviewer
stdout stream feeding the read-only Review pane).

File ownership: see [AGENTS.md](../AGENTS.md).

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
  If no loaded reviewer profile can be resolved from the selection or default,
  the start action stays disabled.
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
  `NECTUS_VERDICT: BLOCKERS|CLEAN` line the reviewer appends; the backend parses
  it and strips that line before storing the review, so the copied Markdown stays
  clean. The verdict is the only structured signal — the review body itself is
  free-form GitHub-flavored Markdown. This is the same `NECTUS_VERDICT:` marker
  contract the task [AI Review](#ai-review) loop uses (PR reviews map the token to
  `passed`/`blockers`/`inconclusive`; the loop maps it to `pass`/`needs_changes`/
  `feedback`).
- The detail view shows the PR metadata and verdict badge, the review text in a
  scrollable pane, a Copy button, a Re-run action (re-fetches the PR head to pick up
  new commits and clears the prior verdict), and Delete.
- For a **single** review the detail also has a **Review / Terminal** toggle: the
  Terminal view is a read-only `xterm.js` pane (the same `ReviewTerminalPane` as the
  task Review tab) that streams the reviewer's stdout live over the
  `pr_review_output` event, so you can watch it inspect the worktree. A running
  review opens on Terminal and a finished one on Review; the live buffer is
  ephemeral (kept while the review stays selected, not persisted). Same caveat as
  the task loop: Codex/OpenCode run in JSON-event mode, so their live output lands
  as one chunk at completion rather than token-by-token, whereas Claude/Antigravity
  stream incrementally. Consensus reviews keep their round matrix and have no
  Terminal toggle.
- Reviewer profiles are the same agent profiles used elsewhere; the default reviewer
  is the configured default agent profile when it is still available, otherwise the
  first available profile. Claude and Antigravity reviewers run with `-p`; Codex reviewers
  run with `codex exec`, OpenCode reviewers run with `opencode run`, and custom
  reviewers receive the prompt on stdin.
- **Session resume for PR reviewers.** Claude, Codex, and OpenCode reviewers resume
  their prior session across reruns of the same PR review (the stored id is in
  `pr_reviews.reviewer_session_id`), so repeat reviews build on earlier findings
  rather than re-reading the PR from scratch. Antigravity and Custom reviewers always
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

The single-review and consensus runtimes share one ephemeral-worktree scaffold and
the shared `NECTUS_VERDICT` marker contract (`native/src/sessions/verdict.rs`);
remote `owner/repo` parsing, the PR-ref
fetch, and worktree-at-ref live in `native/src/git_ops/mod.rs`. The runtime emits the
`pr_review_updated` event. File ownership: see [AGENTS.md](../AGENTS.md).

## GitHub

GitHub integration runs through the `gh` CLI, so Nectus stores no tokens. The app
reports connection status and shows live PR state and CI checks (deterministic `gh`
reads). The four PR **write** actions are **agent-driven**: create, merge
(squash/merge/rebase, behind a confirm), mark a draft ready, and close each submit a
prompt into the task's running agent session, so the agent authors the PR body and
resolves conflicts/rebases itself; a write action needs a running session.
**GitHub Actions / CI checks expand to a per-workflow list** with links straight to
each run, and PR status **auto-refreshes** while the PR is open (interval + window
focus) so checks turn green on their own. A finished AI PR review can be **posted
back to the pull request** as a comment. Full behavior lives in
[GitHub Integration](github-integration.md); file ownership is in
[AGENTS.md](../AGENTS.md).

## JIRA

The JIRA Board is a first-class view (icon rail, alongside PR Reviews), connected
with a JIRA Cloud **API token** pasted in Settings → JIRA (stored in the macOS
Keychain, verified before saving, no other tools needed; a **Create a token**
button deep-links to Atlassian's token page). The token is the only connection —
no CLI dependency, no OAuth. The board is global and fully UI-driven — **no JQL is
typed**: pick a JIRA project from a dropdown and toggle filters (My issues / Hide
done / Current sprint), narrow to a status set, or pick an **Epic** to show only
that epic's children (`parent = "<key>"`). Nectus builds the query behind the
scenes (`jira::build_board_jql`, stored as `jira_board_project` + `jira_filter_*`
flags + `jira_filter_epic`) and loads work items into the project's full status
column set (empty columns included), ordered by JIRA status category.

It is a full management surface: create a new work item, drag a card between
columns to transition it (optimistic — reverted if JIRA's workflow rejects the
move, and carrying the known target status category while the refresh is
pending), and open a card to dock an **inline side panel** beside the board (the
board stays in context as a 2-column split; it is no longer a modal dialog) to
change status, assign, or comment. Successful JIRA writes refresh the board in
place. **New work item** in the toolbar opens an
inline create form in that same dock slot (project defaulting to the board's,
type Task/Bug/Story/Epic, summary, description, assignee, labels). If projects
hydrate after the panel opens, an empty project field adopts the board/default
project once it is available; on submit Nectus creates the item (`POST /issue`),
refreshes the board, and auto-opens the new card's view panel — where the launch
row can immediately start an agent on it. The panel's bottom launch row (agent
select + **Create task & start**, carrying the selected launch agent into the task
composer)
and the card's **Create task** affordance both open the task composer pre-seeded
from the story (title, description) with a project selector; the resulting
task↔story link is stored locally on the task (`jira_issue_key/summary/url`) and
never writes back to JIRA. Linked stories appear as a badge on task
cards/rows and a detachable panel in the task inspector, and — the other direction —
each board card lists the tasks attached to that story (agent logo, title, live/
status), each click-through opening that task.

**Sprint view.** A **Board / Sprint** toggle in the header switches the same
project between the status-column board and JIRA's sprint layout: each active then
future sprint, then the backlog, every section split into **epic swimlanes**
(grouped by each issue's epic), loaded from the Agile REST API
(`/rest/agile/1.0`). v1 is read-only: cards open the work-item panel, create a task
from a story, and show a status pill, but there's no drag — transition from Board
view.

**Custom workflows.** The status dropdown shows the issue's **legal transitions**
(fetched on open), the board renders **every status column** (including empty
ones), and a **status filter** in the board header narrows the board. Full
behavior and caveats live in [JIRA Integration](jira-integration.md); file
ownership is in [AGENTS.md](../AGENTS.md).

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
app is running. Before persisted settings hydrate, the app uses that same System
theme behavior instead of briefly forcing light mode. Settings persist through
the `get_app_settings` / `update_app_settings` commands (the `app_settings`
table). After saving settings, the shell's selected agent is resolved against the
loaded profile list before it is updated, so a stale default profile id in the
returned settings cannot become the active launcher choice.

Settings also has a **Diagnostics** section (section id `diagnostics`, with its
own nav item) showing the backend log live — the same `tracing` output the Rust
side prints to the console (under the `nectus_desktop_lib=info` filter). It
backfills the buffered lines on open via `get_diagnostic_logs`, then streams each
new line via the `diagnostic_log` event, with Refresh / Copy / Clear and tail
auto-follow (follow pauses when you scroll up to read history). The log buffer is
deliberately independent of the global database lock, so it keeps updating even
while a command is stuck holding that lock — which is what makes it useful for
diagnosing a hang (e.g. a slow/blocked `git fetch` during worktree creation). Use
**Copy** to attach the log to a bug report.

File ownership: see [AGENTS.md](../AGENTS.md).

## Auto-Update

The app updates itself in place through the Tauri 2 updater, reading releases
directly from the public repo (`github.com/hvp17/nectus`); no token is needed.
Builds are Apple Silicon (`aarch64`) only. Everything below **no-ops outside
Tauri** (browser preview and tests), so the read-path UI and the suite are
unaffected.

Current behavior:

- One **silent check** runs shortly after launch. If a newer release is found, a
  sonner toast "Update available (vX) → Install" appears; clicking **Install**
  downloads it and, when ready, a second toast "Update installed → Relaunch"
  offers a **Relaunch** action to restart into the new version.
- Settings has an **About & Updates** section (section id `about`, with a nav
  item and a Version overview item) whose card shows the current version, a
  manual **Check for updates** button, a status badge, and the install action
  with download progress and a relaunch action.
- Every fresh check clears any previous install target before reading the
  updater endpoint. If the re-check fails, stale toast actions cannot install an
  older successful update result.
- If checks overlap, only the latest check is allowed to update the visible
  status or install target; slower earlier responses are ignored.
- Update integrity is secured by **Tauri minisign signing** (independent of
  Apple); the public key is committed in `native/tauri.conf.json`. The app is
  ad-hoc code-signed (`bundle.macOS.signingIdentity: "-"`) but not
  Apple-notarized, so the **first** download trips a Gatekeeper "unidentified
  developer" warning the user clears with right-click → **Open** (a "damaged"
  report means the quarantine flag — strip it with
  `xattr -dr com.apple.quarantine "/Applications/Nectus Desktop.app"`).
  Notarization is a future add-on, out of scope.

The update lifecycle is a small state machine (`UpdateStatus`:
`idle | checking | upToDate | available | downloading | ready | error`) exposing
`check()`, `installUpdate()`, `relaunch()`, plus `info`, `currentVersion`,
`progress` (0..1), `error`, and `lastCheckedAt`. The check/toast hooks mount once in
the app shell; the update integrity is secured by Tauri minisign signing, and the
published `latest.json` is
`{ version, notes, pub_date, platforms: { "darwin-aarch64": { signature, url } } }`.
Background polling beyond the launch check, Apple notarization, and
Windows/Linux/Intel builds are out of scope.

Release flow: see [README](../README.md#releases--auto-update) and AGENTS.md
Product Defaults. File ownership: see [AGENTS.md](../AGENTS.md).
