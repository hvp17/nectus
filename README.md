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
- Send the task prompt into a new agent session automatically.
- Resume Codex and Claude sessions when a saved session id is available.
- Track task status across `Planned`, `In progress`, `Review`, and `Done`.
- Drag tasks between board columns to update status.
- Surface running, dirty, finished, review, and needs-input counts.
- Watch Codex session JSONL for finished or input-needed events.
- Send macOS notifications for session attention events.
- Run an AI pair loop that reviews Codex idle events with another agent profile
  and feeds blocking feedback back to the worker session.
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
- AI pair-loop tracking.
- macOS notification troubleshooting.
- Common debugging commands and failure modes.

The Codex JSONL protocol snapshot lives in
[docs/codex-session-jsonl.md](docs/codex-session-jsonl.md).

## Repository Layout

```text
src/                 React app, UI components, typed Tauri API wrapper
native/src/          Rust Tauri commands, database, git ops, session runtime
native/capabilities/ Tauri permission capability files
docs/                Project documentation and debugging references
```

Important frontend files:

- `src/App.tsx`: app shell and top-level composition
- `src/hooks/useApp.ts`: app state, project/task/settings orchestration
- `src/api.ts`: typed frontend wrapper around Tauri commands
- `src/TerminalPane.tsx`: xterm.js lifecycle, PTY input/output, and dropped
  file-path insertion
- `src/components/`: board, task detail, settings, and modal UI

Important backend files:

- `native/src/lib.rs`: Tauri command registration, app setup, plugins, shutdown
- `native/src/db/`: SQLite schema, migrations, row mapping, persistence tests
- `native/src/git_ops.rs`: git repository and worktree operations
- `native/src/sessions/`: PTY lifecycle, agent command setup, Codex JSONL watcher,
  and review-loop worker
- `native/src/models.rs`: serializable backend/frontend contracts
