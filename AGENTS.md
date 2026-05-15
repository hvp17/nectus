# Nectus Desktop Agent Guide

## Project Shape

Nectus Desktop is a Mac-first Tauri 2 desktop app for managing parallel Codex/Claude work across git worktrees.

- Frontend: React + TypeScript + Vite in `src/`
- Desktop backend: Rust + Tauri in `native/`
- Local storage: SQLite through Rust-side `rusqlite`
- Embedded terminal: Rust `portable-pty` backend + `xterm.js` frontend
- Package manager: `pnpm`

The app is local-first. Do not add GitHub OAuth/API sync unless explicitly requested.

## Development Flow

Use Conventional Commits for all commit messages.

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

Use this when working on layout, React state, styling, and non-Tauri UI behavior. In browser-only mode, Tauri commands are unavailable, so repo/worktree operations will only work inside the Tauri app.

Run the full desktop app locally:

```bash
pnpm desktop:dev
```

Use this for validating:

- adding existing git repos
- creating worktrees
- launching Codex/Claude sessions
- terminal input/output
- app-owned session cleanup

## Build And Release

Build the frontend bundle:

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

## Tests

Run frontend tests:

```bash
pnpm test
```

Run Rust tests:

```bash
cd native
cargo test
```

Run the standard verification set before claiming work is complete:

```bash
pnpm test
pnpm build
cd native && cargo test
```

For release-impacting changes, also run:

```bash
pnpm desktop:build
```

## Backend Boundaries

Keep OS, git, SQLite, and PTY behavior in Rust.

Important backend files:

- `native/src/lib.rs`: Tauri command registration and app setup
- `native/src/db.rs`: SQLite schema, migrations, and persistence
- `native/src/git_ops.rs`: git repo/worktree validation and operations
- `native/src/sessions.rs`: PTY lifecycle and terminal event emission
- `native/src/models.rs`: shared serializable data types

Tauri commands exposed to the frontend include:

- `add_repo`
- `list_repos`
- `create_worktree`
- `list_worktrees`
- `update_worktree_metadata`
- `list_agent_profiles`
- `upsert_agent_profile`
- `start_session`
- `stop_session`
- `resize_session`
- `send_session_input`

Terminal events emitted by Rust:

- `session_output`
- `session_exited`

## Frontend Boundaries

Keep React UI and command bindings in `src/`.

Important frontend files:

- `src/App.tsx`: dashboard shell, repo/worktree forms, status columns, detail pane
- `src/TerminalPane.tsx`: xterm.js setup, terminal event listeners, input forwarding
- `src/api.ts`: typed Tauri command wrapper
- `src/types.ts`: frontend data contracts matching Rust serde output
- `src/styles.css`: app-wide styling

Do not call shell/git directly from the frontend. Add Rust commands instead.

Prefer shadcn/ui components for UI primitives as much as possible. Keep custom components to a minimum, and use custom code mainly for app-specific layout, orchestration, and composition around shadcn components rather than reimplementing buttons, alerts, dialogs, inputs, menus, tooltips, cards, or similar primitives.

## Product Defaults

Preserve these V1 decisions unless the user asks to change them:

- Operations dashboard is the primary UI.
- Projects are existing local git repos.
- Worktrees default to a sibling folder: `../<repo-name>-worktrees/<branch-name>`.
- Tasks and PR URLs are stored locally.
- Codex and Claude are launched as configurable CLI commands.
- Embedded sessions are app-owned child processes.
- Closing the app stops owned sessions.

## Notes For Future Changes

- Avoid destructive filesystem deletion for worktrees unless there is an explicit confirmation path.
- Keep GitHub integration optional and additive.
- If adding persistent background sessions, introduce a deliberate session manager such as tmux/zellij instead of silently detaching child processes.
- If adding more terminal features, prefer extending `sessions.rs` and `TerminalPane.tsx` rather than mixing PTY concerns into dashboard components.
- The current icon is a simple generated placeholder and can be replaced later with proper app assets.
