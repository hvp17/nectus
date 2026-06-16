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
- A **single ACP chat** runs in the primary repo's worktree; the other repos are
  reachable as siblings at `../<repoName>`. The task prompt is prefixed with this
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

**Archive**: a done task can be archived from the facts rail. Archived tasks vanish from every live surface — boards,
Mission Control, the sidebar — and from the per-worktree dirty checks, but keep
their row, worktree, and branch until deleted. Both boards have an **Archived**
toggle showing the read-only archive view, where cards offer **Restore** and
**Delete** (archived cards do not open the task workspace).

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

Command resolution checks PATH first, then common user binary locations. The ACP
provider registry owns command arguments and app-specific fallback locations, such
as Codex app bundle resource paths and OpenCode installs under
`~/.opencode/bin/opencode` or `~/bin/opencode`.

File ownership: see [AGENTS.md](../AGENTS.md).

## ACP Agent Chat

The task workspace drives task agents through ACP chat. There is no embedded
task PTY or Terminal tab; the stage is Chat, Diff, and Review.

Current behavior:

- For ACP-capable agents (Claude Code, Codex, OpenCode, and Antigravity preview
  when a descriptor exists), Chat is the default stage tab and the only task-agent
  runtime. Task creation starts ACP chat and submits the initial prompt through
  `acp_send_prompt`.
- GitHub ship actions (`create` / `merge` / `mark-ready` / `close` PR) also
  submit prompts through ACP chat. If the selected task profile has no ACP
  provider, the action declines with guidance to choose an ACP-capable profile.
- Direct-edit tasks launch ACP in the project path. Worktree-backed tasks launch
  ACP in the worktree path. Cross-repo tasks launch in the primary worktree and
  send sibling worktree paths to ACP as `additionalDirectories`.
- Live activity in Mission Control, the project sidebar, and task cards comes from
  `session_chat` text/tool parts via `liveLines` and `chatWorkingTaskIds`, not
  from terminal output, Codex JSONL, Claude hooks, or OpenCode local-server
  watchers.
- On the first prompt, Nectus starts an ACP session for the task's agent profile.
  It streams normalized ACP updates into the transcript and persists settled
  user/agent turns in SQLite.
- ACP launch is driven by the Rust provider descriptor in `native/src/sessions/acp.rs`
  for Claude Code, OpenCode, Codex, and Antigravity (preview). The runtime resolves the descriptor's
  command, seeds the login-shell environment, adds the augmented PATH, applies any
  provider-specific executable override, then applies the selected profile's env
  last so per-profile keys and PATH override the defaults.
- The same descriptor is exported through `list_acp_providers`, including stable
  provider ids, launch argv, and coarse capability states (`expected`, `unknown`,
  or `unsupported`) for resume, permission, and image support. Once a process
  starts, ACP `initialize` is authoritative: the returned runtime capabilities are
  persisted on the chat session and gate image attach and the Resumable badge.
- ACP `initialize` includes Nectus client info and advertises no client
  filesystem/terminal capabilities. Optional MCP servers can be provided per
  agent profile through the `NECTUS_ACP_MCP_SERVERS_JSON` env value, a JSON array
  matching ACP `McpServer[]`; those servers are passed to `session/new` and
  `session/load`. Unsupported filesystem/terminal client requests are left to the
  ACP connection's unsupported-method diagnostics instead of granting host access.
- Prompt turns include text, image blocks only when runtime capabilities allow
  them, baseline ACP resource links for the primary worktree and sibling
  worktree directories, and an embedded Markdown task-context resource when the
  agent advertises `embeddedContext`.
- The Chat tab uses that descriptor export to gate launch and offers a compact
  chat-agent selector populated from the task's agent profiles. Transcript reads
  (`get_task_chat`) and live `session_chat` cache updates are scoped to the
  selected profile's latest session. Switching from one ACP-capable profile to
  another starts a new chat row for the selected profile rather than sending into
  a transcript owned by a different agent. If the selected profile has no ACP
  provider descriptor yet, the composer is disabled with an inline callout.
- The transcript is rendered with **Vercel AI Elements** (installed under
  `src/components/ai-elements/`). A thin adapter in `src/lib/chat/renderChatParts.tsx`
  maps the persisted `ChatPart` v1 model to those presentational primitives — the
  ACP wire format, `session_chat` events, and TanStack Query cache are unchanged.
  Structured parts render as: markdown text (`Message`), reasoning blocks, tool
  rows, file-edit rows, permission confirmations, and plan collapsibles. Tool
  rows follow a Codex-style, low-contrast resting look (transparent until
  hover/expand) on the canvas background: consecutive read/search/fetch calls
  collapse into one summary row (`Read N files and searched code`, with a count
  pill and a per-op list on expand — the grouping is a pure presentation-time
  transform in `src/lib/chat/groupToolParts.ts`, no model/event change); command
  (`execute`) rows show a terminal glyph, `Ran <cmd>`, a Success/Failed/Running
  badge, and a shell block on expand; edit rows show `Edited <file>` with inline
  `+N −M` stats and the new file text on expand (`file_edit.diff` is new text
  only, so it is not a red/green diff — the title still opens the Diff tab). The
  conversation shell auto-scrolls; the composer is the AI-Elements `PromptInput`
  with all controls consolidated into its footer toolbar: image attach (with an
  inline thumbnail-preview header), a slash-command menu, the **permission-mode**
  select (ACP session modes — Claude's default/acceptEdits/plan/bypass — with a
  shield glyph) and the **model / config** selects (ACP v0.14 has no first-class
  model field, so an agent's model is a `Select` config option, id `model`, shown
  with a CPU glyph; other config knobs use a sliders glyph). The right side of the
  footer holds context-window % (`Context`), the checkpoint restore menu, and the
  submit/stop button; the agent picker plus session-title/Resumable/working badges
  sit in a slim strip above the input.
- Permission confirmations support allow/reject once or always; "always" choices
  persist in `chat_permission_policies` and are auto-applied on future matching tool
  titles. File chips switch the workspace to the Diff tab and select the matching
  changed file so its patch loads immediately.
- After each settled agent turn, Nectus snapshots `git rev-parse HEAD` into
  `chat_checkpoints`. The Chat tab exposes a Checkpoints menu to restore a prior
  turn with `git reset --hard` in the task worktree.
- The composer queues follow-up prompts on the live ACP connection (serial user/agent
  turns). The Stop button sends ACP `session/cancel` for the active turn and keeps
  the process alive; `acp_stop_chat` remains the hard-stop backend command.
- Image attach is available when the initialized agent advertises image prompt
  support. Before a process has initialized, the static provider descriptor is
  used only as a pre-launch hint.
- A **Resumable** badge appears when the persisted row has an `acp_session_id` and
  the initialized agent advertises `loadSession`.
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
`acp_cancel_prompt`, `acp_set_session_mode`, `acp_set_config_option`,
`acp_stop_chat`, `list_chat_permission_policies`, `clear_chat_permission_policies`,
`list_chat_checkpoints`, and `restore_chat_checkpoint`; live updates arrive on
`session_chat`, `session_chat_usage`, and `session_chat_runtime`. Settings →
Diagnostics lists saved permission policies. When an ACP connection ends,
`chat_session_exited` clears ephemeral chat runtime state in the shell. File
ownership: see [AGENTS.md](../AGENTS.md).

## Task Diff

The task workspace stage has a `Chat | Diff | Review` segmented control, so you
can talk to the task agent, inspect what changed, or watch a reviewer without
leaving the app. The stage header carries a changed-file count badge and
`+a −d` line totals next to the toggle (visible on all tabs), the Diff tab adds a
manual refresh control, the Chat tab is covered in [ACP Agent Chat](#acp-agent-chat),
and the Review tab is covered in [AI Review](#ai-review).

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
  refresh control. Each refresh is a cheap local `git diff` with no network/GitHub
  call.
- Rename detection is disabled (`--no-renames`), so a rename shows as a delete + add
  pair.

The diff is served by the `task_diff_summary` / `task_diff_file` commands; base
resolution, numstat/name-status parsing, and untracked patches live in
`native/src/git_ops/diff.rs`. File ownership: see [AGENTS.md](../AGENTS.md).

## ACP Chat Resume

ACP chat rows may store the provider's `acp_session_id`. When the provider
advertises `session/load`, the next prompt can restart the ACP process and call
`session/load` to resume the prior conversation. If the provider cannot load the
saved session, Nectus starts a fresh ACP session and sends the prompt instead of
leaving the composer stuck.

The old Codex JSONL, Claude PTY hook, and OpenCode local-server resume probes are
not used for task agents anymore. Reviewer resume is separate and documented under
[AI Review](#ai-review).

## Attention Tracking

Attention tracking is UI state derived from backend events.

- ACP permission parts in `session_chat` set `needs_input` attention.
- Chat text and tool parts update `liveLines` and `chatWorkingTaskIds`, which drive
  Mission Control, sidebar rows, task cards, and the icon-rail badge.
- Settled turns and `chat_session_exited` clear the working state.
- Stale `tasks.active_session_id` and `tasks.attention` values from old PTY builds
  are cleared on app startup so they do not block ACP-only workflows.
- Marking done, deleting a task, or answering a permission prompt clears the marker
  for that task.
- Counts are shown as Mission Control summary pills and the icon-rail needs-input
  badge.
- macOS notifications are sent for ACP attention and review/PR review updates when
  permission is granted.
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

Chat/review/PR events are subscribed once in the mount-once event bridge and
routed to the query cache or the UI store. ACP chat drives task attention and live
lines via `session_chat`, `session_chat_usage`, and `chat_session_exited`. File
ownership: see [AGENTS.md](../AGENTS.md).

## AI Review

AI review is a single reviewer pass over the selected task worktree, run as a
**headless ACP agent session** — the same mechanism chat uses, not a spawned CLI.

Current behavior:

- Use the task workflow stepper's `Review with <reviewer>` action to run one
  reviewer pass.
- The review action shows the reviewer profile icon and name inline. Use the
  adjacent dropdown to switch reviewer profiles before starting the pass.
- The review action switches the selected task UI to `reviewing` while the headless
  ACP review turn runs, and the task workflow stepper shows the in-progress state.
- **Only ACP providers can review.** A reviewer profile must be Claude, Codex,
  OpenCode, or Antigravity; a **Custom** agent has no ACP descriptor and the review
  fails fast with a clear error telling you to choose an ACP provider.
- The workspace stage has a read-only **Review** tab that streams the agent's live
  message (`review_output` chunks emitted by `native/src/sessions/review_loop.rs`
  via the ACP review driver `review_runtime.rs`) into an `xterm.js` pane, so you can
  watch the reviewer inspect the worktree in real time. Starting a review
  auto-selects this tab; the facts-rail review card's `Watch live` / `View output`
  button opens it too. The tab is read-only — there is no input, session, or
  snapshot — and between runs it shows the last recorded reviewer output. The review
  turn runs with no human present, so the driver auto-approves every ACP permission
  request the agent raises.
- The task workflow stepper enables `Create PR` for worktree tasks once the
  GitHub CLI is connected. Creating a PR, merging, marking ready, and closing are
  all agent-driven through ACP chat: the action submits a prompt, the agent
  commits/pushes, authors the PR title and description itself, opens the PR, and
  rebases/resolves conflicts as needed. A write action needs an ACP-capable task
  profile; with none it declines with guidance. PR detection and live status stay
  deterministic `gh` reads. See [GitHub Integration](github-integration.md).
- The task workflow stepper also shows a `Move to done` step that marks the
  task complete.
- PR URLs are stored on the task: captured automatically by the `gh`-driven flow,
  or written through task metadata when linked manually or by the agent.
- The reviewer is launched the same way a chat agent is — one headless ACP turn
  (initialize → `session/new` or `session/load` → one prompt → stream the agent's
  message → stop), driven by `native/src/sessions/review_runtime.rs`. There are no
  per-provider CLI flags or stdout parsing anymore; the agent speaks ACP.
- **Session resume for reviewers (ACP-native).** Repeat rounds resume the prior
  conversation rather than re-reading the worktree cold:
  - The driver sends `session/load` only when the agent advertises the `loadSession`
    capability; a reviewer that does not simply starts a fresh `session/new`.
  - Stored reviewer session ids are now **ACP session ids**. Ids minted before this
    upgrade are not ACP ids and won't resume, so the first post-upgrade review per
    task/PR starts fresh.
  - Task-loop ids are stored in `review_loops.reviewer_session_id` (reset when
    the loop is restarted). PR-review ids are stored in
    `pr_reviews.reviewer_session_id` (preserved across reruns). Consensus
    keeps per-reviewer ids in memory for the duration of one run.
- The verdict is a validated trailing fenced ` ```json ` block carrying
  `{"verdict": "clean|blockers|feedback"}`, parsed by `parse_verdict_block` in
  `native/src/sessions/verdict.rs` (the same contract the PR reviews use); the block
  is stripped from what is stored. If the first turn omits a parseable block, the
  driver does ONE-SHOT self-repair (a second prompt in the same session asking for
  just the block):
  - `pass` ← `clean`
  - `needs_changes` ← `blockers`
  - `feedback` ← `feedback`
  - `unknown` when no parseable block is present (there is no natural-language
    fallback — a review that merely quotes a phrase like "blocking issue" is not
    classified).
- Passing review marks the loop `passed` and moves the task to `done`.
- Task cards show the saved review status once a review exists, including
  completed `Review passed` state.
- Blocking review or implementation feedback is stored as review output and shown
  in the UI. It is no longer written into a worker PTY.
- Unknown reviewer output marks the loop `error`.

The review-loop runtime emits two Tauri events: `review_loop_updated` (loop/run
state changes, routed to the query cache) and `review_output` (the live reviewer
stdout stream feeding the read-only Review pane).

File ownership: see [AGENTS.md](../AGENTS.md).

## PR Review

PR Review reviews an external GitHub pull request against a known local project and
produces a Markdown review to copy back to the author. It is separate from the task
board: reviews have their own rail section and lifecycle, and share the worktree,
ACP review driver (`review_runtime.rs`), and notification machinery under the hood.

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
- The review runs on a background task: it fetches PR metadata (`gh pr view`),
  checks out the PR head into an ephemeral worktree
  (`git fetch origin pull/<n>/head` + `git worktree add`), runs the reviewer as a
  headless ACP session in that worktree, stores the Markdown review, and always
  tears the worktree down.
- Status flows `queued → reviewing → ready`, or `error` on failure. A macOS
  notification and in-app toast fire when a review becomes `ready` or `error`.
- The list groups reviews into three lifecycle sections — **To review**
  (`queued`), **Reviewing** (`reviewing`), and **Done** (`ready` and `error`) —
  each with a count.
- A finished review also carries a `verdict` that the Done badge surfaces:
  **Passed** (no blockers), **Blocking issues**, or **Inconclusive** (the reviewer
  finished without a recognizable verdict). An `error` review shows **Error**
  instead and has no verdict. The verdict comes from a validated trailing fenced
  ` ```json ` block carrying `{"verdict": "blockers|clean"}` that the reviewer
  appends; the backend parses it and strips the block before storing the review, so
  the copied Markdown stays clean. The verdict is the only structured signal — the
  review body itself is free-form GitHub-flavored Markdown. This is the same JSON
  verdict-block contract the task [AI Review](#ai-review) loop uses (PR reviews map
  the token to `passed`/`blockers`/`inconclusive`; the loop maps it to
  `pass`/`needs_changes`/`feedback`).
- The detail view shows the PR metadata and verdict badge, the review text in a
  scrollable pane, a Copy button, a Re-run action (re-fetches the PR head to pick up
  new commits and clears the prior verdict), and Delete.
- For a **single** review the detail also has a **Review / Terminal** toggle: the
  Terminal view is a read-only `xterm.js` pane (the same `ReviewTerminalPane` as the
  task Review tab) that streams the agent's message live over the
  `pr_review_output` event, so you can watch it inspect the worktree. A running
  review opens on Terminal and a finished one on Review; the live buffer is
  ephemeral (kept while the review stays selected, not persisted). Consensus
  reviews keep their round matrix and have no Terminal toggle.
- Reviewer profiles are the same agent profiles used elsewhere; the default reviewer
  is the configured default agent profile when it is still available, otherwise the
  first available profile. As with task reviews, **only ACP providers (Claude,
  Codex, OpenCode, Antigravity) can review** — a Custom reviewer fails fast.
- **Session resume for PR reviewers (ACP-native).** When the agent advertises the
  `loadSession` capability, a rerun of the same PR review resumes its prior ACP
  session (the stored id is in `pr_reviews.reviewer_session_id`), so repeat reviews
  build on earlier findings rather than re-reading the PR from scratch; an agent
  without that capability reviews fresh. Stored ids are ACP session ids, so a
  pre-upgrade id won't resume and the first post-upgrade rerun starts fresh.
  See the [AI Review](#ai-review) section for the shared resume mechanics.

**Consensus mode.** Selecting two or more reviewers (optionally setting a round
count, 1–5, default 3) runs them as a consensus review:

- The PR head is checked out once and every reviewer reads it in round 1. From
  round 2 on, each reviewer also sees the other reviewers' prior-round notes and
  gives a fresh verdict, so they can converge.
- Reviewing stops early the moment all reviewers agree on a recognizable verdict
  (`passed`/`blockers`); otherwise it runs the full round budget.
- Reviewers fan out concurrently (async `futures::future::join_all`), so a round
  runs them in parallel rather than one after another.
- The **synthesizer** (the first-selected reviewer) folds every reviewer's latest
  review into one consolidated Markdown review. When the reviewers converged, that
  shared verdict is authoritative; otherwise the stored `verdict` is the
  synthesizer's own verdict block.
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

The single-review and consensus runtimes share one ephemeral-worktree scaffold, the
headless ACP review driver (`native/src/sessions/review_runtime.rs`), and the shared
JSON verdict-block contract (`native/src/sessions/verdict.rs`); remote `owner/repo`
parsing, the PR-ref fetch, and worktree-at-ref live in `native/src/git_ops/mod.rs`.
The runtime emits the `pr_review_updated` event. File ownership: see
[AGENTS.md](../AGENTS.md).

## GitHub

GitHub integration runs through the `gh` CLI, so Nectus stores no tokens. The app
reports connection status and shows live PR state and CI checks (deterministic `gh`
reads). The four PR **write** actions are **agent-driven**: create, merge
(squash/merge/rebase, behind a confirm), mark a draft ready, and close each submit a
prompt into the task's ACP chat, so the agent authors the PR body and resolves
conflicts/rebases itself; a write action needs an ACP-capable task profile.
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
