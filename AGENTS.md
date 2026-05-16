# Nectus Desktop Agent Guide

## Project Shape

Nectus Desktop is a Mac-first Tauri 2 desktop app for managing parallel Codex/Claude work across local git projects and optional git worktrees.

- Frontend: React + TypeScript + Vite in `src/`
- Desktop backend: Rust + Tauri in `native/`
- Local storage: SQLite through Rust-side `rusqlite`
- Embedded terminal: Rust `portable-pty` backend + `xterm.js` frontend
- Package manager: `pnpm`

The app is local-first. Do not add GitHub OAuth/API sync unless explicitly requested.

## Every Coding Session

- Start by inspecting the current checkout and the files that own the behavior you are changing. Do not rely on stale summaries when the repo is available.
- Preserve user changes in the working tree. Do not revert unrelated edits.
- Keep documentation up to date in the same change whenever behavior, commands, data models, troubleshooting steps, or project structure changes.
- Update `README.md` for onboarding, setup, build, verification, or high-level feature changes.
- Update `docs/features.md` when user-visible workflows, feature behavior, settings, session behavior, or ownership boundaries change.
- Update `docs/tracking-and-debugging.md` when persistence, events, diagnostics, failure modes, or debugging commands change.
- Update `docs/codex-session-jsonl.md` when Codex JSONL assumptions, supported events, or session-log parsing changes.
- Update `AGENTS.md` itself when development workflow, verification gates, important paths, or coding-session rules change.
- Keep documentation concrete and repo-grounded. Prefer exact commands, file paths, table names, event names, and known caveats over general prose.
- Do not add placeholder docs such as `TODO`, `TBD`, or speculative behavior unless it is clearly marked as a future idea outside current behavior.

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

Do not start a dev server after making changes unless the user explicitly asks you to run one. The user decides when to launch `pnpm dev`, `pnpm desktop:dev`, or any other long-running local server.

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

## Documentation Map

- `README.md`: project overview, setup, build, verification, and repo layout.
- `docs/features.md`: feature map and ownership references.
- `docs/tracking-and-debugging.md`: SQLite state, Tauri commands/events, task/session tracking, logs, and troubleshooting.
- `docs/codex-session-jsonl.md`: Codex rollout JSONL reference and caveats.

## Backend Boundaries

Keep OS, git, SQLite, and PTY behavior in Rust.

Important backend files:

- `native/src/lib.rs`: Tauri command registration and app setup
- `native/src/db/`: SQLite schema, migrations, row mapping, and persistence tests
- `native/src/git_ops.rs`: git repo/worktree validation and operations
- `native/src/sessions/`: PTY lifecycle, terminal event emission, Codex JSONL watching, agent command setup, and review-loop runtime
- `native/src/models.rs`: shared serializable data types

Tauri commands exposed to the frontend include:

- `add_repo`
- `list_repos`
- `get_app_settings`
- `update_app_settings`
- `create_task`
- `list_tasks`
- `update_task_metadata`
- `delete_task`
- `list_agent_profiles`
- `upsert_agent_profile`
- `start_pair_loop`
- `stop_pair_loop`
- `get_task_review_loop`
- `list_task_review_runs`
- `start_session`
- `resume_session`
- `stop_session`
- `resize_session`
- `send_session_input`
- `session_output_snapshot`

Events emitted by Rust:

- `session_output`
- `session_exited`
- `session_idle`
- `session_needs_input`
- `review_loop_updated`

## Frontend Boundaries

Keep React UI and command bindings in `src/`.

Important frontend files:

- `src/App.tsx`: app shell and top-level composition
- `src/hooks/useApp.ts`: app state, project/task/settings orchestration
- `src/TerminalPane.tsx`: xterm.js setup, terminal event listeners, input forwarding
- `src/api.ts`: typed Tauri command wrapper
- `src/types.ts`: frontend data contracts matching Rust serde output
- `src/components/`: board, task detail, settings, and modal UI
- `src/styles.css`: app-wide styling

Do not call shell/git directly from the frontend. Add Rust commands instead.

Prefer shadcn/ui components for UI primitives as much as possible. Keep custom components to a minimum, and use custom code mainly for app-specific layout, orchestration, and composition around shadcn components rather than reimplementing buttons, alerts, dialogs, inputs, menus, tooltips, cards, or similar primitives.

## Product Defaults

Preserve these V1 decisions unless the user asks to change them:

- Operations dashboard is the primary UI.
- Projects are existing local git repos.
- Worktrees default to a sibling folder: `../<repo-name>-worktrees/<branch-name>`.
- Tasks can be direct-edit or worktree-backed; worktree is optional.
- Tasks and PR URLs are stored locally.
- Codex, Claude, Gemini, and custom agents are launched as configurable CLI commands.
- Embedded sessions are app-owned child processes.
- Closing the app stops owned sessions.

## Notes For Future Changes

- Avoid destructive filesystem deletion for worktrees unless there is an explicit confirmation path.
- Keep GitHub integration optional and additive.
- If adding persistent background sessions, introduce a deliberate session manager such as tmux/zellij instead of silently detaching child processes.
- If adding more terminal features, prefer extending `native/src/sessions/` and `src/TerminalPane.tsx` rather than mixing PTY concerns into dashboard components.
- The current icon is a simple generated placeholder and can be replaced later with proper app assets.
