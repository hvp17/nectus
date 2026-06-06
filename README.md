# Nectus Desktop

Nectus Desktop is a Mac-first Tauri 2 app for coordinating parallel AI coding
work across local git projects and optional git worktrees.

It is local-first. Projects, tasks, agent profiles, session state, review-loop
history, and settings are stored in the local SQLite database created by the
desktop app. The frontend does not call git or shell commands directly; OS,
git, SQLite, and PTY work lives in the Rust backend.

## Features

- Add existing local git repositories as Projects.
- Create Tasks against a project in direct-edit mode or with a new git worktree;
  blank worktree branch names become generated `task-...` branches.
- Launch Codex, Claude, Gemini, or custom CLI agent profiles in an embedded
  terminal.
- Triage every agent across all projects from Mission Control, the default home:
  rows grouped by who needs you (needs-input, running, review, done) carry the
  agent's latest line and an inline action; click a row to open the task.
- Navigate with a slim icon rail (Mission Control, Board, JIRA, PR Reviews,
  Settings); a needs-input badge on the rail flags work waiting on you.
- Open a selected task into a focused terminal workspace with task details in a
  persistent right inspector, plus an inline action bar when the agent is waiting.
- Delete tasks from board cards or the selected-task inspector with background
  progress toasts.
- Send the task prompt into a new agent session automatically.
- Resume Codex and Claude sessions when a saved session id is available.
- Track task status across `Planned`, `In progress`, `Review`, and `Done`.
- Drag tasks between board columns to update status.
- Show saved review status on task cards.
- Surface running, dirty, finished, review, and needs-input counts.
- Watch Codex session JSONL for finished or input-needed events.
- Send macOS notifications for session attention events.
- Run a single AI review with another agent profile and feed blockers or
  implementation feedback back to the worker session.
- Review an external GitHub pull request from the PR Reviews view — paste a PR
  link, pick one reviewer, or two or more for a multi-model **consensus** that
  runs the reviewers over rounds, shows a convergence matrix, and synthesizes a
  single verdict. See [docs/features.md](docs/features.md#pr-review).
- Submit a Create PR prompt to a running agent from the task workflow.
- Manage a global JIRA board (via the Atlassian CLI `acli`): pick a project from a
  dropdown and toggle filters — no JQL to write — then browse stories in
  auto-derived status columns, drag to transition, assign and comment, and create a
  task from a story with a local-only task↔story link. Requires `acli` installed and
  `acli jira auth login`. No tokens are stored by default. An **optional** API token
  (Settings → JIRA, kept in the macOS Keychain) adds custom-workflow support — legal
  transitions, all status columns, and a board status filter. See
  [docs/jira-integration.md](docs/jira-integration.md).
- Configure agent commands, model arguments, environment variables, theme,
  density, branch prefixes, and worktree root patterns.

See [docs/features.md](docs/features.md) for the feature map and user flows.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui components
- Desktop shell: Tauri 2
- Backend: Rust
- Storage: SQLite through `rusqlite`
- Terminal: `portable-pty` in Rust and `xterm.js` in React
- Package manager: `pnpm`

## Development

Install dependencies:

```bash
pnpm install
```

Fresh git worktrees do not share `node_modules`. Run `pnpm install` before
using `pnpm exec shadcn ...`, `pnpm test`, or `pnpm build` in a new worktree.

Run the web UI only:

```bash
pnpm dev --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:1420/
```

Browser-only mode is useful for layout and React behavior. Tauri commands are
not available there, so repository, worktree, SQLite, notification, and PTY
behavior must be validated in the desktop app.

Run the desktop app:

```bash
pnpm desktop:dev
```

Build the frontend:

```bash
pnpm build
```

Build the Mac desktop app and DMG:

```bash
pnpm desktop:build
```

Expected release outputs:

```text
native/target/release/bundle/macos/Nectus Desktop.app
native/target/release/bundle/dmg/Nectus Desktop_0.1.0_aarch64.dmg
```

## Verification

Run the standard checks before calling a change complete:

```bash
pnpm test
pnpm build
cd native
cargo test
```

If Rust tests that shell out to git fail with `No such file or directory`, rerun
with an explicit PATH before changing code:

```bash
cd native
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH cargo test
```

## Tracking And Debugging

The main tracking and debugging guide is
[docs/tracking-and-debugging.md](docs/tracking-and-debugging.md). It covers:

- SQLite tables and task/session fields.
- Tauri commands and emitted frontend events.
- Codex JSONL tracking and its current limitations.
- AI review tracking.
- macOS notification troubleshooting.
- Common debugging commands and failure modes.

The Codex JSONL protocol snapshot lives in
[docs/codex-session-jsonl.md](docs/codex-session-jsonl.md).

## Repository Layout

```text
src/                 React app, UI components, typed Tauri API wrapper
src/components/settings/
                     Settings subcomponents and pure profile-draft helpers
src/styles/          Focused CSS files for layout, settings, task board, detail,
                     forms, the task diff (diff.css), and the reimagined shell
                     (redesign.css)
src/test/            Shared Vitest and Testing Library helpers
native/src/          Rust Tauri commands, database, git ops, session runtime
native/src/sessions/agents/
                     Provider-specific Codex, Claude, and Gemini launch behavior
native/capabilities/ Tauri permission capability files
docs/                Project documentation and debugging references
```

Important frontend files:

- `src/App.tsx`: icon-rail shell, view routing, and top-level composition
- `src/components/IconRail.tsx`: 58px primary navigation rail with needs-input badge
- `src/components/ProjectPanel.tsx`: contextual project list shown beside the board
- `src/components/MissionControl.tsx`: cross-project attention-first triage home
- `src/lib/agentState.ts`: derives each task's cross-project state, latest line, and
  elapsed time for Mission Control and the board
- `src/hooks/useApp.ts`: app state, project/task/settings orchestration
- `src/hooks/useTaskReviewLoop.ts`: review-loop loading and
  `review_loop_updated` event subscription
- `src/hooks/useTaskDeletion.ts`: task deletion workflow and deletion toasts
- `src/hooks/useSessionAttentionControls.ts`: wrappers that clear attention
  before session start/resume/stop/input events
- `src/hooks/useTaskCardPointerDrag.ts`: task-card pointer drag tracking and
  drag ghost lifecycle
- `src/api.ts`: typed frontend wrapper around Tauri commands
- `src/TerminalPane.tsx`: xterm.js lifecycle, PTY input/output, and dropped
  file-path insertion
- `src/components/`: icon rail, Mission Control, board, task workspace (terminal/diff/review stage), settings, GitHub/JIRA panels, and the inline composer/side-panel UI
- `src/components/TaskDiffView.tsx`: in-app task diff viewer (changed-file list + lazy unified patch)
- `src/components/ReviewTerminalPane.tsx`: read-only xterm.js pane for a task reviewer's live output
- `src/components/TaskDeleteDialog.tsx`: shared task deletion confirmation UI
- `src/styles.css`: Tailwind imports, theme tokens, and global base rules
- `src/styles/`: focused CSS files imported by `src/main.tsx`
- `src/test/testUtils.tsx`: shared DOM, pointer-event, tooltip-provider, and
  async helpers for frontend tests
- `src/test/app*Tests.tsx`: focused App test groups registered by
  `src/App.test.tsx`

Important backend files:

- `native/src/lib.rs`: Tauri command registration, app setup, plugins, shutdown
- `native/src/db/`: SQLite schema, row mapping, domain persistence
  modules, and persistence tests
- `native/src/git_ops.rs`: git repository and worktree operations
- `native/src/sessions/`: PTY lifecycle, agent command setup, Codex JSONL watcher,
  and review-loop worker
- `native/src/sessions/agents/`: Codex, Claude, and Gemini command argument
  builders and provider-specific fallback locations
- `native/src/models.rs`: serializable backend/frontend contracts
