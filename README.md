# Nectus Desktop

Nectus Desktop is a Mac-first Tauri 2 app for coordinating parallel AI coding
work across local git projects and optional git worktrees.

It is local-first. Projects, tasks, agent profiles, session state, review-loop
history, and settings are stored in the local SQLite database created by the
desktop app. The frontend does not call git or shell commands directly; OS,
git, SQLite, and PTY work lives in the Rust backend.

## Features

- Add existing local git repositories as Projects.
- Create Tasks against a project in direct-edit mode or with a new git worktree.
- Launch Codex, Claude, Gemini, or custom CLI agent profiles in an embedded
  terminal.
- Open a selected task into a focused terminal workspace with task details in a
  persistent right inspector.
- Use the sidebar Tasks section to see the total task count, create tasks, and
  jump to or stop active sessions.
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
- Submit a Create PR prompt to a running agent from the task workflow.
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
                     and forms
src/test/            Shared Vitest and Testing Library helpers
native/src/          Rust Tauri commands, database, git ops, session runtime
native/src/sessions/agents/
                     Provider-specific Codex, Claude, and Gemini launch behavior
native/capabilities/ Tauri permission capability files
docs/                Project documentation and debugging references
```

Important frontend files:

- `src/App.tsx`: app shell and top-level composition
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
- `src/components/`: board, task workspace, settings, and modal UI
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
