# Architecture — How Nectus Desktop Connects

**Start here.** This is the one-page mental model of the whole app: the layers, how
a user action becomes a database row or a terminal write, how backend events flow
back to the UI, and where to go to change any given thing. Read this first, then
follow the [doc index](#documentation-index) to the deep references.

Nectus Desktop is a Mac-first **Tauri 2** app for running parallel Codex / Claude /
Gemini / OpenCode agents across local git projects and worktrees. It is
**local-first**: the React frontend never shells out. Every OS, git, SQLite, PTY,
and external-CLI (`gh`, `acli`) operation happens in the Rust backend and is
reached through a typed Tauri command boundary.

## The five layers

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  FRONTEND  (src/)  — React + TypeScript + Vite                           │
  │  components ─▶ hooks ─▶ src/queries/ (TanStack Query)  +  src/store/      │
  │                                                          (Zustand)        │
  └───────────────┬───────────────────────────────▲──────────────────────────┘
        src/api.ts │ invoke(command)               │ events → useEventBridge
                   ▼                                │
  ┌────────────────────────────────────────────────┴──────────────────────────┐
  │  COMMAND BOUNDARY  native/src/lib.rs  — every #[tauri::command] +          │
  │  generate_handler! registration + app setup (plugins, updater)            │
  └───────────────┬───────────────────────────────────────────────────────────┘
                  ▼            ▼            ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐
  │   db/    │ │ git_ops/ │ │ sessions/│ │ github.rs│ │ jira.rs / jira_rest.rs│
  │ rusqlite │ │ git CLI  │ │portable- │ │  gh CLI  │ │   acli CLI / REST     │
  │  SQLite  │ │ worktrees│ │ pty PTY  │ │   (PRs)  │ │ (board, transitions)  │
  └──────────┘ └──────────┘ └────┬─────┘ └──────────┘ └──────────────────────┘
                                 │ .emit("session_*", "review_*", "pr_review_*")
                                 ▼
        Rust events ─▶ src/hooks/useEventBridge.ts (mount-once) ─▶
            TanStack Query cache  +  Zustand store ─▶ components re-render
```

**Down (a request):** a component calls a hook → the hook calls a wrapper in
`src/api.ts` → `invoke("command_name", …)` crosses into Rust → `lib.rs` runs the
command body, which delegates to a domain module (`db/`, `git_ops/`, `sessions/`,
`github.rs`, `jira*.rs`) that touches SQLite, the filesystem/git, a PTY, or an
external CLI.

**Up (live state):** long-running work (PTY sessions, review loops, PR reviews)
emits Tauri events from Rust. The single **mount-once** `useEventBridge` (in
`AppLayout`) is the *only* place that subscribes; it routes each event into the
TanStack Query cache or the Zustand store, and components re-render from there. No
component subscribes to backend events directly (three deliberate exceptions:
`TerminalPane` consumes `session_output`, `useTaskReviewLoop` consumes
`review_output`, `useTaskDiff` consumes `session_idle`).

### State ownership

- **Server state** (anything that comes from a Tauri command — repos, tasks,
  settings, GitHub/JIRA status, reviews) lives in **`src/queries/`** (TanStack
  Query). There is no per-component loading/`useState` boilerplate.
- **UI / runtime state** (current view, selection, the New Task composer draft,
  push-driven live activity lines, toasts, the global busy flag) lives in
  **`src/store/`** (Zustand, composed from concern-split slices).
- There is **no `useApp` god-hook** — it was dissolved. Behavior lives in focused,
  self-sufficient hooks (`useComposer`, `useTaskActions`, `useWorkspaceActions`,
  `useSessionControls`, `useShellBootstrap`, …) that read the queries/store
  directly and can be called from any component.

### Loading boundaries

`AppRouter.tsx` keeps the core shell, Mission Control, and project/workspace
boards eager, then lazy-loads secondary views (Settings, PR Reviews, JIRA),
on-demand overlays (composer, workspace manager, task workspace), and the command
palette behind `Suspense`. Inside the task workspace, `TaskWorkspaceStage` keeps
the header/ribbon eager but lazy-loads the active `Terminal | Diff | Review` pane
so xterm and diff rendering code load only when that surface is shown.

## One request, traced end to end

Starting an agent session shows every layer in motion:

1. **UI** — the user clicks Start in `TaskWorkspace`; a `useSessionControls`
   handler runs.
2. **api** — it calls `api.startSession(...)`, which is `invoke("start_session", …)`
   (`src/api.ts`).
3. **command** — `start_session` in `native/src/lib.rs` resolves the agent profile
   and task, then calls into `native/src/sessions/`.
4. **backend work** — `sessions/mod.rs` spawns the agent CLI on a `portable-pty`
   PTY, with its `PATH` set to `process_util::augmented_path()` so node-based CLIs
   can find `node` (missing this is the classic `env: node … exit 127` failure).
5. **events up** — as the PTY produces output and the provider's session log shows
   activity, Rust emits `session_output`, `session_activity`, and (on
   idle/needs-input) `session_idle` / `session_needs_input`.
6. **bridge** — `useEventBridge` routes those into the task's live-activity line
   (Zustand) and the attention list; `TerminalPane` separately renders the raw
   `session_output` stream into xterm.js.
7. **persist** — the session id / agent / cwd are written back to the `tasks` row
   (`db/tasks.rs`) so the session can later be resumed.

The reverse contract — events the backend can emit — is the same for review loops
(`review_loop_updated`, `review_output`) and PR reviews (`pr_review_updated`).

## Where does X live?

| To change… | Backend (`native/src/`) | Frontend (`src/`) |
|---|---|---|
| Add / change a Tauri command | `lib.rs` (register in `generate_handler!`) + the domain module | `api.ts` + a hook in `queries/` |
| Task / workspace persistence | `db/tasks.rs`, `db/workspaces.rs`, `db/schema.rs` | `queries/core.ts` |
| Agent PTY / terminal behavior | `sessions/mod.rs`, `sessions/agents/` | `TerminalPane.tsx`, `useSessionControls.ts` |
| Session / review / PR events | Rust `.emit(...)` in `sessions/` | `hooks/useEventBridge.ts` (route) |
| UI / runtime state (view, selection, composer) | — | `store/` slices |
| Git repo / worktree / diff | `git_ops/mod.rs`, `git_ops/diff.rs` | `useTaskDiff.ts`, `TaskDiffView.tsx` |
| GitHub (PRs, checks, ship actions) | `github.rs` | `useGithub.ts`, `components/github/` |
| JIRA (board, work items, transitions) | `jira.rs`, `jira_rest.rs`, `jira_secret.rs` | `useJira.ts`, `components/Jira*` |
| AI review loop / PR consensus review | `sessions/review_loop.rs`, `pr_review.rs`, `pr_consensus.rs`, `reviewer.rs` | `useTaskReviewLoop.ts`, `usePrReviews.ts` |
| Spawning any external CLI (PATH rules) | `process_util.rs` | — |
| Shared data contracts (serde ↔ TS) | `models/` | `types.ts` |
| App shell / routing / lazy boundaries | `lib.rs` (Tauri setup) | `AppRouter.tsx`, `App.tsx` (providers only), `TaskWorkspaceStage.tsx` |

## Entry-point files for a new contributor

Backend:

1. `native/src/lib.rs` — every Tauri command + app setup. The backend front door.
2. `native/src/db/schema.rs` — the full SQLite data model (all tables in one place).
3. `native/src/sessions/mod.rs` — PTY lifecycle + the shared event-log tail loop;
   where live events originate.
4. `native/src/process_util.rs` — the external-CLI spawn rules every git / `gh` /
   `acli` / agent call depends on.

Frontend:

5. `src/AppRouter.tsx` — the React shell; how queries, store, the event bridge,
   and the lazy-loaded view/overlay boundaries compose into routed views.
6. `src/hooks/useEventBridge.ts` — the single mount-once bridge routing Rust events
   into the Query cache / Zustand store.
7. `src/queries/core.ts` (+ `keys.ts`, `cache.ts`) — the server-state read layer all
   data hooks build on.
8. `src/api.ts` + `src/types.ts` — the typed command boundary and the
   serde-mirroring contracts.

## Verify a change

```bash
pnpm verify               # vitest, build, Rust test/fmt/clippy
```

For release-impacting changes also run `pnpm desktop:build`. See
[README](../README.md#verification) for the git-PATH caveat on Rust tests.

## Documentation index

Grouped by concern, with a single owner per topic:

| Concern | Doc | Owns |
|---|---|---|
| **Orientation** | **`docs/architecture.md`** (this file) | The layer model, the traced request lifecycle, the "where does X live" table |
| **Setup / build / release** | [`README.md`](../README.md) | Install, dev/`desktop:dev`, build, verification, the auto-update release flow |
| **Agent operating rules** | [`AGENTS.md`](../AGENTS.md) (= `CLAUDE.md` symlink) | Coding-session rules, shadcn/Context7 workflow, the External-CLI PATH rule, the authoritative backend & frontend **file maps** |
| **Feature behavior** | [`docs/features.md`](features.md) | Per-feature *behavior* narrative (semantics, flows — not the file map) |
| **Persistence & debugging** | [`docs/tracking-and-debugging.md`](tracking-and-debugging.md) | SQLite tables, the **canonical Tauri command + event reference**, task/session fields, debugging flows |
| **Codex JSONL** | [`docs/codex-session-jsonl.md`](codex-session-jsonl.md) | The Codex rollout-JSONL contract Nectus tails |
| **GitHub** | [`docs/github-integration.md`](github-integration.md) | `gh`-CLI connection, PR create/detect/status/ship, external + consensus PR review |
| **JIRA** | [`docs/jira-integration.md`](jira-integration.md) | `acli` + optional Keychain REST, the JQL board, work-item flows, task↔story link |
| **Design archive** | [`docs/superpowers/`](superpowers/) | Dated, point-in-time design specs/plans — historical intent, not current truth |
