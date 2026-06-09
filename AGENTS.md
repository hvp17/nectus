# Nectus Desktop Agent Guide

> `CLAUDE.md` is a symlink to this file — they are the same guide. For the
> connected layer model (how frontend ↔ commands ↔ SQLite/PTY/CLIs ↔ events fit
> together), a traced request lifecycle, and a **"where does X live"** table, read
> [`docs/architecture.md`](docs/architecture.md) first. This file owns the
> coding-session rules and the authoritative per-file **backend & frontend maps**.

## Project Shape

Nectus Desktop is a Mac-first Tauri 2 desktop app for managing parallel Codex, Claude, and OpenCode work across local git projects and optional git worktrees.

- Frontend: React + TypeScript + Vite in `src/`
- Desktop backend: Rust + Tauri in `native/`
- Local storage: SQLite through Rust-side `rusqlite`
- Embedded terminal: Rust `portable-pty` backend + `xterm.js` frontend
- GitHub: optional integration through the local `gh` CLI (no OAuth, no stored tokens)
- Package manager: `pnpm`

The app is local-first. GitHub work shells out to the `gh` CLI the same way it shells out to `git`; do not add app-managed GitHub OAuth or token storage unless explicitly requested.

## Every Coding Session

- Start by inspecting the current checkout and the files that own the behavior you are changing. Do not rely on stale summaries when the repo is available.
- Preserve user changes in the working tree. Do not revert unrelated edits.
- Keep files concise and split code by concern, type, provider, domain, or workflow when a file starts mixing responsibilities or becomes difficult to scan.
- Keep documentation up to date in the same change whenever behavior, commands, data models, troubleshooting steps, or project structure changes.
- Update `README.md` for onboarding, setup, build, verification, or high-level feature changes.
- Update `docs/features.md` when user-visible workflows, feature behavior, settings, session behavior, or ownership boundaries change.
- Update `docs/tracking-and-debugging.md` when persistence, events, diagnostics, failure modes, or debugging commands change.
- Update `docs/codex-session-jsonl.md` when Codex JSONL assumptions, supported events, or session-log parsing changes.
- Update `docs/github-integration.md` when `gh` CLI usage, connection checks, or pull request create/detect/status behavior changes.
- Update `docs/jira-integration.md` when `acli` usage, the board JQL/columns, work-item management, or task↔story link behavior changes.
- Update `AGENTS.md` itself when development workflow, verification gates, important paths, or coding-session rules change.
- Keep documentation concrete and repo-grounded. Prefer exact commands, file paths, table names, event names, and known caveats over general prose.
- Do not add placeholder docs such as `TODO`, `TBD`, or speculative behavior unless it is clearly marked as a future idea outside current behavior.
- `.claude/` is a local working area for Claude settings and nested worktrees; keep it ignored and never stage files from inside it. Vitest also excludes it so copied worktrees do not duplicate the test suite.
- Fresh git worktrees usually start without `node_modules`. Before running `pnpm exec shadcn ...`, `pnpm test`, `pnpm build`, or other package-backed commands, check whether dependencies are hydrated and run `pnpm install` first when they are missing.
- If `pnpm exec shadcn ...` starts dependency hydration or fails with missing packages such as `vite`, stop repeating shadcn probes and run one `pnpm install`; if the install is blocked by sandboxed network or DNS, request escalation for `pnpm install` rather than retrying multiple shadcn commands.

## Library Documentation

Use Context7 MCP to fetch current documentation for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services when implementation depends on current syntax, setup, version behavior, or component usage. Start with `resolve-library-id` unless an exact Context7 ID such as `/org/project` is already known, then use `query-docs` with the full question.

Prefer Context7 results over memory for library-specific API usage. For shadcn/ui, use the Context7 library ID `/shadcn-ui/ui` when needed.

## shadcn/UI Frontend Work

For every frontend UI change, read the current shadcn/ui documentation before choosing or composing primitives. Use Context7 with `/shadcn-ui/ui` for docs context, and use the local shadcn workflow to inspect project state and component docs:

```bash
pnpm install
pnpm exec shadcn info --json
pnpm exec shadcn docs <component>
```

Prefer shadcn primitives from `src/components/ui/` over custom markup and styling. Before creating a custom component, check whether an installed shadcn primitive or official registry item already covers the need:

- actions: `Button`
- forms: `Field`, `Input`, `Textarea`, `Select`, `Switch`, `RadioGroup`, `ToggleGroup`
- overlays: `Dialog`, `AlertDialog`, `Sheet`, `Tooltip`, `DropdownMenu`
- structure and display: `Card`, `Badge`, `Separator`, `Sidebar`, `ScrollArea`
- feedback and states: `Alert`, `Empty`, `Skeleton`, `sonner`

Add or update shadcn components through the CLI rather than copying component source by hand:

```bash
pnpm dlx shadcn@latest add @shadcn/<component>
```

When the CLI reports that existing UI files would be overwritten, inspect the impact first and only use `--overwrite` after explicit user approval. After adding a component, read the generated files and update app code to use the exported primitive APIs instead of preserving parallel custom implementations.

Keep custom React components focused on Nectus-specific composition, data flow, drag behavior, terminal behavior, and product workflow. Do not reimplement generic buttons, forms, empty states, badges, alerts, dialogs, menus, tooltips, cards, separators, or sidebars when shadcn provides the primitive.

## Importing a Claude Design Export

Claude Design (Anthropic Labs, `claude.ai/design`) hands a redesign back as a self-contained bundle, not an API. A share link of the form `https://api.anthropic.com/v1/design/h/<id>` returns a **gzip tarball** (fetch it, then `tar -xzf`); the curated handoff lives under `…/design_handoff_*/` and contains:

- `colors_and_type.css` — the design system. It is **ported verbatim from this repo's `src/styles.css`**, so the OKLCH tokens already match 1:1.
- `app/*.jsx` + `app/{views,details,mocks}.css` — prototype artboards. The exact px/rem/weight/radius/gap values live in these `nx-`prefixed prototype classes; treat them as the spec. **Do not ship the prototype HTML/JSX.**
- `README.md` — per-surface intent and the real repo files each one touches.
- `reference/` — a snapshot of the prior app for diffing.

Integrate it **deeply into the existing theme and components**, never as a parallel layer:

1. **Tokens are the source of truth.** `src/styles.css` owns the OKLCH palette, radius, shadow, tracking, and font roles (`--font-sans` Geist, `--font-mono` Geist/JetBrains, `--font-serif` Source Serif 4). Map every color to an existing token (`--primary`, `--status-success|warning|info`, `--destructive`, `--muted-foreground`, `--border`, …). **Introduce no new colors/hex.**
2. **Recreate, don't paste.** Rebuild each surface with the installed shadcn primitives in `src/components/ui/*` plus the `nx-` classes in `src/styles/redesign.css` and the per-surface CSS (`settings.css`, `detail.css`, `task-board.css`). Translate the prototype's `nx-` classes to these conventions.
3. **Install shadcn primitives as needed.** When a surface calls for a primitive that is not yet vendored (e.g. `Switch`), add it with `pnpm dlx shadcn@latest add <component>` and use the exported API rather than a hand-rolled control.
4. **Preserve behavior.** These are presentation reworks: keep all data, handlers, `data-testid`s, `aria-label`s, and `data-*` hooks; update the tests when an interaction model intentionally changes.
5. **Audit fidelity per surface.** Diff each surface against its prototype (spacing, type scale, weights, element states, ordering) and fix divergences; run `pnpm test` and `pnpm build` before claiming done.

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

Use this when working on layout, React state, styling, and non-Tauri UI behavior. In browser-only mode, Tauri commands are unavailable, so repo/worktree operations will only work inside the Tauri app. To make every page previewable there, `src/lib/browserSeed.ts` seeds realistic read-path data (projects, cross-project tasks with attention states, JIRA board, PR reviews incl. a consensus example) — gated on `isBrowserPreview` (outside Tauri **and** outside the test runner), so the real backend and the test suite are unaffected. Live terminals still need the Tauri PTY.

Do not start a dev server after making changes unless the user explicitly asks you to run one. The user decides when to launch `pnpm dev`, `pnpm desktop:dev`, or any other long-running local server.

Run the full desktop app locally:

```bash
pnpm desktop:dev
```

Use this for validating:

- adding existing git repos
- creating worktrees
- launching Codex/Claude/OpenCode sessions
- terminal input/output
- app-owned session cleanup

## Build And Release

Build the frontend bundle:

```bash
pnpm build
```

The frontend TypeScript build runs with `strict`, `noUnusedLocals`, and
`noUnusedParameters`; remove dead locals/parameters instead of leaving them for a
later cleanup.

Build the Mac desktop app and DMG:

```bash
pnpm desktop:build
```

The `desktop:build` script sets `CARGO_INCREMENTAL=1` for faster repeat Rust
release builds while still producing the normal app and DMG bundles.

Expected release outputs:

```text
native/target/release/bundle/macos/Nectus Desktop.app
native/target/release/bundle/dmg/Nectus Desktop_<version>_aarch64.dmg
```

The `<version>` is the current `package.json` version (the single source of truth).

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

Run Rust linting:

```bash
cd native
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Run the standard verification set before claiming work is complete:

```bash
pnpm verify
```

For release-impacting changes, also run:

```bash
pnpm desktop:build
```

## Documentation Map

One owner per concern — don't duplicate another doc's content; point to it.

- `docs/architecture.md`: **start here.** The five-layer model, the traced request
  lifecycle, and the "where does X live" table.
- `README.md`: project overview, setup, build, verification, the auto-update release
  flow, and the doc index.
- `AGENTS.md` (this file, = `CLAUDE.md`): coding-session rules, the shadcn/Context7
  workflow, the External-CLI PATH rule, and the authoritative backend & frontend
  **file maps** (the single source of truth for file ownership).
- `docs/features.md`: per-feature *behavior* narrative (semantics and flows — not the
  file map).
- `docs/tracking-and-debugging.md`: SQLite tables, the **authoritative Tauri command +
  event reference**, task/session fields, logs, and troubleshooting.
- `docs/codex-session-jsonl.md`: Codex rollout JSONL reference and caveats.
- `docs/github-integration.md`: `gh` CLI connection model and pull request create/detect/status/ship flows.
- `docs/jira-integration.md`: `acli` (Atlassian CLI) connection model, JQL board, auto-derived columns, work-item management, and local task↔story links.
- `docs/superpowers/`: dated design archive (historical intent, not current truth).

## Backend Boundaries

Keep OS, git, SQLite, and PTY behavior in Rust.

Important backend files:

- `native/src/main.rs`: binary entry point that calls `nectus_desktop_lib::run`
- `native/src/lib.rs`: Tauri command registration, command bodies, and app setup; `run()` also registers `tauri_plugin_process::init()` and `tauri_plugin_updater::Builder::new().build()` for the auto-updater. `native/tauri.conf.json` carries `bundle.createUpdaterArtifacts: true` plus a `plugins.updater` block (endpoint `https://github.com/hvp17/nectus/releases/latest/download/latest.json` + a base64 minisign pubkey, safe to commit), and `native/capabilities/default.json` grants `updater:default` + `process:allow-restart`
- `native/src/db/`: SQLite access split by domain into `impl Database` blocks — `mod.rs` (connection open/pragmas, repos, the `now`/`generated_branch_name` helpers), `tasks.rs` (single- and cross-repo task CRUD; `create_cross_repo_task` fans out a worktree per repo as siblings under a shared parent, with per-repo state in the `task_repos` child table — `tasks.*` stays the primary repo), `settings.rs`, `sessions.rs`, plus `agent_profiles.rs`, `review_loops.rs`, `pr_reviews.rs`, `workspaces.rs` (durable repo groups: CRUD with transactional `workspace_repos` membership); `schema.rs` (create/migrate), `rows.rs` (row mapping), and `tests.rs` (persistence tests)
- `native/src/git_ops/`: git repo/worktree validation and operations — `mod.rs` (the `git_output`/`git_output_allowing_codes` helpers, repo/branch validation, worktree-root pattern, remote resolution, worktree create/remove/branch lifecycle, `is_dirty`) and `diff.rs` (the cohesive task-diff sub-domain: `resolve_diff_base`, `diff_summary`, `diff_file`, re-exported from `mod.rs`)
- `native/src/github.rs`: `gh` CLI integration — connection status, pull request detect/status parsing (incl. the per-check GitHub Actions/CI drill-down parsed from one `gh pr view` `statusCheckRollup`), and `comment_on_pull_request` for posting a review back (no OAuth, no stored tokens). PR **writes** (create/merge/mark-ready/close) are agent-driven, not `gh`-shell-out from Rust — the agent runs `git`/`gh` in the worktree (see `src/hooks/useGithubShipActions.ts`); the old deterministic write helpers/commands were removed once the UI stopped calling them
- `native/src/jira.rs`: `acli` (Atlassian CLI) integration — connection status, project list, work-item search/view/create/transition/assign/comment with tolerant JSON parsing, the structured-config JQL builder (`build_board_jql`, incl. the `status in (...)` filter clause, so the UI never types JQL), and the create argument builder + new-key parser (`build_create_args`, `parse_created_key`); no OAuth, no stored tokens
- `native/src/jira_rest.rs`: **optional** JIRA Cloud REST layer (`ureq`, Basic auth) for what `acli` cannot do — fixture-tested parsers `parse_transitions` / `parse_project_statuses`, plus `verify` (`/myself`), `list_transitions`, `project_statuses`, `perform_transition`. Additive to `acli`, gated on a user API token; powers the legal-transition dropdown, the board status filter, and all status columns (incl. empty)
- `native/src/jira_secret.rs`: macOS Keychain store for the optional JIRA API token (`keyring`; service = the app identifier, account = `jira-api-token:{site}`). The token never touches SQLite — only the non-secret site/email persist in `app_settings`
- `native/src/process_util.rs`: shared command helpers — binary resolution (`resolve_executable`), child `PATH` augmentation (`augmented_path`), the install-dir source of truth (`third_party_bin_dirs`), and `command_error` stderr formatting. See [Spawning External CLIs](#spawning-external-clis-macos-gui-path).
- `native/src/sessions/`: PTY lifecycle, terminal event emission, Codex JSONL watching, Claude Code hook event bridge (`claude.rs`), OpenCode local-server `/event` watching (`opencode.rs`), agent command setup, and the task review-loop / external PR-review runtimes (`review_loop.rs`, `pr_review.rs`, `pr_consensus.rs`). The append-only event-log tail loop shared by the Codex and Claude watchers (`watch_event_log` in `mod.rs`) keeps line-tailing in one place: it tails **incrementally** by byte offset (reading only appended bytes, not re-reading the whole growing file each tick) while still deferring a partial trailing line until its newline arrives. Per-provider session-lifecycle facts live in one descriptor, `provider.rs` (`provider_session(kind)`: `needs_local_server`, `emits_structured_activity`, `sends_prompt_in_args`, `cleanup_event_sink`, and which `WatcherKind` to spawn) — the lifecycle sites in `mod.rs` consume it instead of re-deriving an `if Codex … else if Claude …` ladder; `resolve_resumable_metadata` is the shared post-exit probe. Each provider watcher also feeds the live `session_activity` line via `SessionSignal::Activity` from its structured stream (Codex `agent_reasoning`/`agent_message`, Claude `PreToolUse` hook, OpenCode `message.part.updated`), normalized/throttled/de-duplicated by `emit_activity_line`; the raw-PTY `latest_activity_line` scraper is reserved for Gemini/custom agents (gated by `provider_session(kind).emits_structured_activity`), since on a full-screen TUI it only surfaced statusline chrome and echoed keystrokes. The headless reviewer-CLI launcher shared by all three reviewing surfaces lives in `reviewer.rs`; it owns the session-resume contract: `run_reviewer_command(reviewer, cwd, prompt, resume: Option<&str>, stream) -> Result<ReviewerRunOutput, String>`, `reviewer_supports_resume(AgentKind)` (true for Claude/Codex/OpenCode), and `new_reviewer_session_id()`. Per-provider reviewer stdout decoding — plain text for Claude/Gemini/custom, newline-delimited JSON events for Codex (`exec --json`) and OpenCode (`run --format json`) with session-id extraction — lives in `reviewer_output.rs`. The PTY submission helper is in `terminal_io.rs`. The single + consensus PR runtimes share one ephemeral-worktree scaffold (`pr_worktree.rs`: unique per-review branch/path + guaranteed teardown). The agent-verdict contract is shared app-wide in `verdict.rs` (the `NECTUS_VERDICT:` marker + `VerdictToken` enum + parse/strip helper); `pr_verdict.rs` (PR reviews) and `review_loop.rs` (task loop) are thin adapters mapping the token to their own domain enums — no natural-language fallback
- `native/src/sessions/agents/`: provider-specific Codex, Claude, Gemini, and OpenCode command arguments and fallback locations
- `native/src/models/`: shared serializable data types, split by domain (`error`, `task`, `review`, `agent`, `github`, `jira`, `settings`, `session`, `workspace`) and re-exported flat from `mod.rs`, so every `crate::models::Foo` path still resolves

All Tauri commands are registered in `generate_handler!` in `native/src/lib.rs`,
grouped by domain: repos & settings, tasks & workspaces, task diff, GitHub PRs,
JIRA (`acli` + optional REST), agent profiles, the task AI review loop, external PR
reviews, and PTY sessions. Rust emits eight events — `session_output`,
`session_activity`, `session_idle`, `session_needs_input`, `session_exited`,
`review_loop_updated`, `review_output`, `pr_review_updated`.

The **authoritative, exhaustive command and event reference** (with each one's
purpose and source) lives in
[`docs/tracking-and-debugging.md`](docs/tracking-and-debugging.md) — keep that the
single source of truth rather than re-listing commands here.

## Spawning External CLIs (macOS GUI PATH)

A macOS app launched from Finder/Dock (or the packaged `.app`) inherits only a
minimal PATH — `/usr/bin:/bin:/usr/sbin:/sbin` — with no Homebrew or user bin
directories. This breaks externally-spawned CLIs in two distinct ways. Both are
handled in `native/src/process_util.rs`, whose `third_party_bin_dirs` is the
single source of truth for the extra locations
(`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, …):

1. **Finding the CLI itself.** Resolve the binary with `resolve_executable` (for
   `gh` and general tools) or `resolve_agent_command` (for agent profiles); both
   search PATH first, then the common install dirs.
2. **Tools the CLI then spawns.** A resolved absolute path is not enough —
   node-based CLIs such as Codex and OpenCode exec `node` themselves, which must be on the
   child process's PATH. Set `command.env("PATH", process_util::augmented_path())`
   on the spawned command so nested executables resolve too. Missing this surfaces
   as `env: node: No such file or directory` with **exit status 127**.

**Rule:** whenever you spawn an external process — `std::process::Command` or
portable-pty `CommandBuilder` — resolve the binary with the helpers above *and*
set its `PATH` to `augmented_path()`. Apply any profile-provided env afterwards so
a profile's own PATH still wins. Current call sites:

- agent PTY sessions — `native/src/sessions/mod.rs`
- the reviewer launch shared by the task AI review loop and external PR reviews —
  `native/src/sessions/reviewer.rs` (`run_reviewer_command`)
- `git` invocations in repo/worktree operations resolve `git` via
  `resolve_executable` and set `PATH` to `augmented_path`
  (`native/src/git_ops/mod.rs`).
- `gh` invocations resolve `gh` via `resolve_executable`; `gh` is a single static
  binary that spawns no node, so it needs resolution but not `augmented_path`
  (`native/src/github.rs`).
- `acli` invocations resolve `acli` via `resolve_executable`; like `gh` it is a
  single binary that spawns no node, so it needs resolution but not `augmented_path`
  (`native/src/jira.rs`).

## Frontend Boundaries

Keep React UI and command bindings in `src/`.

Important frontend files:

- Frontend infrastructure (the three layers the shell composes):
  - `src/queries/`: the **TanStack Query** server-state layer — `queryClient.ts` (per-mount client factory + a `QueryCache` error handler that surfaces `meta.surfaceErrors` reads), `keys.ts` (the key catalog), `cache.ts` (`makeCacheSetter`, a `setState`-shaped writer backed by the cache), `core.ts` (bootstrap read hooks: repos/workspaces/tasks/agentProfiles/settings), and per-domain query hooks (`github.ts`, `jira.ts`). **Every data hook is Query-backed**: `useGithub`, `useJira`, `usePrReviews`, `useTaskReviewLoop`, and `useTaskDiff` read/write the cache (no `useState`/`useAsyncEffect` loading boilerplate, no request-ordering refs). All server/command reads and cache writes go through here, not component state.
  - `src/hooks/useEventBridge.ts`: the single, **mount-once** Tauri event bridge (mounted in `AppLayout`). It owns every session/review/PR subscription (`session_activity`/`idle`/`needs_input`/`exited`, `review_loop_updated`, `pr_review_updated`) and routes each event to the query cache (tasks, review loop/runs, PR reviews) or the Zustand store (`liveLines`/`taskAttention`/toast/message). `session_exited` resolves its task via `activeSessionId` (the payload has no taskId). Because events are centralized, the domain hooks are pure cache consumers callable per-component. `review_output` (per-component live stream) stays in `useTaskReviewLoop`; `useTaskDiff` keeps its own `session_idle` (mounted once); `TerminalPane` keeps `session_output`.
  - `src/store/`: the **Zustand** UI/runtime store — `appStore.ts` composes concern-split slices (`navigation`, `selection`, `composer`, `runtime`, `sessionRuntime`, `notification`); `setState.ts` makes setters `SetStateAction`-compatible drop-ins for `useState`. Owns the shell state that is NOT server state: `currentView`/`activeWorkspaceId`, selection (repo/task/agent), the New Task composer draft, the push-driven `liveLines`/`taskAttention`, `deletingTaskIds`, `message`/`taskToast`, and the global `busy` flag. (Per-domain selection like the open PR-review / JIRA item lives in those domain hooks/views.)
  - `src/AppRouter.tsx`: the persistent **shell** — `AppLayout` composes the shell's data directly from queries + the store (there is no `useApp` god-hook anymore), runs `useEventBridge` + `useShellBootstrap` once, and renders **either an overlay** (`ComposerOverlay`, the open task's `TaskWorkspaceOverlay`, or the workspace manager) **or the current view directly** off the store's `currentView` — a plain switch, no router (the desktop shell has no URL bar, so view navigation is synchronous). Mission Control and the project/workspace boards stay eager; secondary rail views (settings, PR reviews, JIRA), on-demand overlays, and the command palette are `React.lazy` chunks behind `Suspense` boundaries. The leaf views are **self-sufficient** — each reads its own queries/store/domain-hooks; only the cross-cutting `openTask` / `openCreateTaskModal` / `appUpdate` flow through a small React context. (Despite the filename, there is no `@tanstack/react-router`; the desktop shell navigates via a plain `currentView` switch, not a router.)
- `src/App.tsx`: thin root that mounts the app-wide providers (`QueryClientProvider` + `TooltipProvider`) with a fresh `QueryClient` per mount for test isolation, then renders `<AppLayout/>`; all shell/view logic lives in `src/AppRouter.tsx`
- `src/components/IconRail.tsx`: always-collapsed icon-only rail (~60px, icon buttons under the brand "N" mark; width is the `--nx-rail-w` token in `redesign.css`). Each button is icon-only with a shadcn `Tooltip` naming it and keeps its `aria-label`; the Mission Control icon carries a corner needs-input badge. Hosts a foot "New task" icon button (`onCreateTask`/`canCreateTask`) that opens the composer from any view
- `src/components/ProjectPanel.tsx`: the persistent navigator panel — **Projects** and **Workspaces** sections, each opening its own board (project board or aggregated workspace board), with each scope's in-flight agents nested inline as compact `SidebarAgentRow` cards and a workspace ⓘ info card (Popover) listing member projects; replaces both the old running-agents popup and the scoped project rail. Persistent on Mission Control, project board, workspace board, and an open task's details; hidden only when the composer or workspace manager is open
- `src/components/SidebarAgentRow.tsx`: compact in-flight agent card rendered inside the navigator panel's nested agent lists; shows agent logo, branch, latest activity line, elapsed time, and click-to-focus action. Shares the `nx-fly-row*` CSS vocabulary
- `src/lib/sidebarAgents.ts`: pure helper — buckets in-flight agents (`ACTIVE_AGENT_STATES`) by repo (`byRepo`) and by workspace (`byWorkspace`), plus `dominantState` (most urgent state in a row list)
- `src/components/WorkspaceManager.tsx`: de-modaled inline composer to create/rename/re-scope/delete workspaces with a per-repo checklist
- `src/components/MissionControl.tsx`: cross-project, attention-first triage home (the default view), grouped needs_you → running → review → done → idle
- `src/lib/agentState.ts`: maps a task + attention to its cross-project state, latest line, and elapsed time (shared by Mission Control and the board)
- Frontend action/composition hooks (what replaced the `useApp` god-hook — each is self-sufficient, reading the store + query cache directly, callable from any component):
  - `src/hooks/useTaskActions.ts` (status/rename/JIRA-link), `useTaskDeletion.ts` (delete; `deletingTaskIds` lives in the store), `useWorkspaceActions.ts` (workspace CRUD), `useSettingsActions.ts` (save settings/agent profile), `useProjectActions.ts` (add repo), `useSidebarCollapse.ts` (fold a project's/workspace's nested agent list — optimistic repos/workspaces cache write + `set_repo_collapsed`/`set_workspace_collapsed` persist, revert on failure), `useJiraToken.ts` (JIRA REST token connect/disconnect), `useSessionControls.ts` (start/resume/stop session + attention clearing), `useShellBootstrap.ts` (boot-time default agent/repo selection + drop-deleted-workspace, via `getState()`).
  - `src/hooks/useComposer.ts`: the New Task composer — the draft lives in the store's composer slice; this owns the create-task submit (single / worktree / cross-repo routing) and "create from JIRA story". `activeWorkspaceId` is the **focused** workspace (drives the workspace board), not a global filter; the composer's cross-repo mode is the separate `newTaskWorkspaceId` toggle, switchable to any eligible workspace.
  - `src/components/TaskWorkspaceOverlay.tsx`: assembles every `TaskWorkspace` prop from per-task hooks (`useGithub`, `useTaskReviewLoop`, task/session actions, inline PR-create/start-review), keeping `TaskWorkspace` a pure presentational component.
- `src/hooks/useSessionCommands.ts`: start/resume/stop/resize/input session command bindings
- `src/hooks/useGithub.ts`: **read-only** GitHub state — `gh` connection status, the live PR-status query, existing-PR detection/backfill, and the open-PR auto-refresh (interval + window focus, off for terminal PRs). The PR **write** actions moved out (see below)
- `src/hooks/useGithubShipActions.ts`: the four PR write actions (create/merge/mark-ready/close), now **agent-driven** — each submits a prompt (from `src/lib/githubAgentPrompts.ts`) into the task's running agent session via `submit_session_input` so the agent runs `git`/`gh`, authors the PR body, and rebases/resolves conflicts itself; declines with guidance when no session is running. Wired in `TaskWorkspaceOverlay`. `GitHubPanel`/`PullRequestActions` are presentational and unchanged
- `src/lib/githubAgentPrompts.ts`: pure builders for the create/merge/mark-ready/close prompts (the single iteration surface for shipping behavior)
- `src/hooks/useJira.ts`: `acli` connection status, board items, columns, and optimistic transition. Also owns the optional REST layer: `restStatus`/`restConnected`, the project status set (`projectStatuses`), `setApiToken`/`clearApiToken`, and the connected `deriveColumns` variant (full status skeleton incl. empty columns, narrowed by the status filter)
- `src/hooks/useTaskReviewLoop.ts`: selected-task review-loop loading and event handling, including the live reviewer output stream (`review_output`) for the read-only Review pane
- `src/hooks/useTaskDiff.ts`: task diff data — summary load, lazy per-file patches, and `session_idle` refresh
- `src/hooks/useTaskCardPointerDrag.ts`: task-card pointer drag and ghost lifecycle
- `src/hooks/useTaskDeletion.ts`: task deletion workflow and deletion toasts
- `src/hooks/useSessionAttentionControls.ts`: session controls that clear task attention
- `src/TerminalPane.tsx`: xterm.js setup, terminal event listeners, input forwarding
- `src/api.ts`: typed Tauri command wrapper
- `src/types.ts`: frontend data contracts matching Rust serde output
- `src/components/`: sidebar, Mission Control, board, task workspace (workflow ribbon + facts rail), settings, GitHub panel, and the inline composer/side-panel UI (no modals/dialogs for create-task or JIRA work items)
- `src/components/TaskWorkspace.tsx`: selected-task workspace orchestrator — owns the derived workflow/review state and composes the stage and facts rail. The stage has a `Terminal | Diff | Review` toggle, with the diff or the read-only reviewer terminal getting the full stage when active. A starting review auto-selects the Review tab; the facts-rail review card has a `Watch live`/`View output` button that opens it too
- `src/components/taskWorkspace/`: the workspace's presentation pieces — `TaskWorkspaceStage` (header, workflow ribbon, stage body), `TaskWorkspaceFactsRail` (inspector: metadata, GitHub/JIRA panels, review card, brief, delete), and the leaf helpers `ActionBar`, `TaskStatusBadges`, `TaskTerminalLauncher`. `TaskWorkspaceStage` lazy-loads the active stage pane (`TerminalPane`, `TaskDiffView`, or `ReviewTerminalPane`) so xterm and diff rendering code do not inflate the task-workspace shell chunk
- `src/components/TaskDiffView.tsx`: task diff view — changed-file list plus the lazy-loaded, line-colorized unified patch pane
- `src/components/ReviewTerminalPane.tsx`: read-only xterm.js pane that renders a task reviewer's live stdout (and its last recorded output between runs); no input, session, or snapshot
- `src/components/GitHubPanel.tsx`: task-inspector GitHub panel for connection state and pull request actions; composes `src/components/github/PullRequestActions.tsx` (merge with a squash/merge/rebase confirm dialog, mark-ready, close) and `src/components/github/PullRequestChecks.tsx` (the expandable per-workflow GitHub Actions / CI check drill-down with run links)
- `src/components/JiraBoardPage.tsx`: global JIRA board view — JQL config, auto-derived columns, drag-to-transition; composes `JiraBoardBody` (column grid + empty/loading states) and `JiraCard` (draggable story card + its linked Nectus tasks)
- `src/components/JiraWorkItemDialog.tsx`: `JiraWorkItemPanel` — the de-modaled work-item side panel docked beside the board (transition/assign/comment + an agent-select "Create task & start" launch row). When a REST token is connected, the status dropdown shows the issue's legal transitions (fetched on open); otherwise it falls back to the board-derived options
- `src/components/JiraCreateWorkItemPanel.tsx`: `JiraCreateWorkItemPanel` — the inline "New work item" create form docked in the board's right-hand slot (project/type/summary/description/assignee/labels → `acli jira workitem create`); shares the slot with the view panel
- `src/components/JiraPanel.tsx`: task-inspector panel for the linked JIRA story (display + detach)
- `src/components/settings/`: settings subcomponents (`ProfileEditor`, `GithubConnectionCard`, `JiraConnectionCard` — the optional JIRA REST API-token connect/disconnect card, `SegmentedRadioGroup`, `SettingsOverviewItem`, `UpdateCard` — the Settings "About & Updates" card: current version, "Check for updates" button, status badge, install/relaunch actions) and profile-draft helpers
- `src/lib/update.ts`: Tauri-guarded updater wrapper (`isUpdaterAvailable`, `getAppVersion`, `checkForUpdate`, `installUpdate(update, onProgress)`, `relaunchApp`); no-ops outside Tauri
- `src/hooks/useAppUpdate.ts`: update state machine (`UpdateStatus = "idle"|"checking"|"upToDate"|"available"|"downloading"|"ready"|"error"`); runs one silent check shortly after launch; exposes `check`/`installUpdate`/`relaunch`, plus `info`, `currentVersion`, `progress`, `error`, `lastCheckedAt`. No-op outside Tauri
- `src/hooks/useAppUpdateToast.ts`: fires sonner launch update toasts ("Update available → Install", "Update installed → Relaunch"). Both hooks are mounted in `src/AppRouter.tsx` (`AppLayout`)
- `src/test/testUtils.tsx`: shared frontend test helpers for providers, pointer events, DOM rects, and async deferrals
- `src/test/app*Tests.tsx`: focused App test groups registered by `src/App.test.tsx`
- `src/styles.css`: **the single theme entry** — `@import "tailwindcss"`, the `@theme inline` token→utility bridges (only meaningful lines: the `--color-*`/`--radius-*`/`--font-*`/`--tracking-*` namespaces; no self-referential no-ops), the `:root`/`.dark` OKLCH design tokens, the `@layer base` reset, and global chrome (scrollbars, `::selection`). Imported first so Tailwind's cascade-layer order (`theme → base → components → utilities`) is established before any surface CSS.
- `src/styles/`: per-surface CSS imported by `src/main.tsx`, holding only Nectus-specific composition that shadcn primitives + utilities can't express — all `nx-`/surface-prefixed, consuming `var(--token)` (introduce no new colors). **Each is wrapped in `@layer components` so Tailwind utilities still override it** (this is what lets a utility on an `nx-` element win — unlayered CSS would outrank every utility): `redesign.css` (shell / Mission Control / board / task cards / reviews / consensus / JIRA / settings shell), `detail.css` (task-workspace grid + terminal/reviewer panes), `task-board.css` (card state-rail + drag ghost), `diff.css` (task diff view). **`settings.css` (agent-profile editor + brand logos) is the one intentionally _unlayered_ file**: its `.profile-editor*` classes restyle shadcn primitives (Card/Field/Input/Badge) and `.profile-status-badge` uses a per-`data-agent-kind` `color-mix(var(--agent-accent) …)` with no static-utility equivalent, so it needs unlayered precedence until a `ProfileEditor` refactor. (The dead pre-redesign `layout.css` was removed.)

Do not call shell/git directly from the frontend. Add Rust commands instead.

Use the shadcn/UI Frontend Work rules above for all visible React UI changes.

## Product Defaults

Preserve these V1 decisions unless the user asks to change them:

- Operations dashboard is the primary UI.
- Projects are existing local git repos.
- Worktrees default to a per-project folder under a hidden home directory: `~/.nectus/worktrees/<repo-name>/<branch-name>`. The pattern is configurable in Settings and must include `{repoName}`; a leading `~` expands to `$HOME`.
- Tasks can be direct-edit or worktree-backed; worktree is optional.
- Tasks and PR URLs are stored locally.
- GitHub integration runs through the local `gh` CLI; the app stores no GitHub tokens and runs no OAuth flow.
- Codex, Claude, Gemini, OpenCode, and custom agents are launched as configurable CLI commands.
- Embedded sessions are app-owned child processes.
- Closing the app stops owned sessions.
- The Tauri 2 auto-updater reads GitHub Releases of the public repo `github.com/hvp17/nectus` directly (no token); Apple Silicon (aarch64) only. Installed copies run one silent check shortly after launch (and on demand via Settings → About & Updates → "Check for updates"). Update integrity is secured by Tauri minisign signing, independent of Apple. The app is not Apple-notarized/signed, so the first download triggers a Gatekeeper "cannot verify"/"damaged" warning the user clears with right-click → Open; notarization is a future add-on, out of scope.
- Release flow: `package.json` is the single source of truth for the app version — bump only its `version`, then merge to `main`. `native/tauri.conf.json` reads it via `"version": "../package.json"`; `native/Cargo.toml` (and its `Cargo.lock` entry) is frozen at `0.0.0` and unused for app versioning (nothing reads `CARGO_PKG_VERSION`), so never bump those. `.github/workflows/release.yml` runs on every push to `main`: a `check` job reads `package.json`'s version and only proceeds if no GitHub Release `vX.Y.Z` exists yet (so non-bump merges are no-ops); the `release` job (macos-latest/arm64, `tauri-apps/tauri-action@v0` with `GITHUB_TOKEN` + the `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets) builds aarch64, signs the updater artifacts, creates the `vX.Y.Z` tag at the merge commit, and auto-publishes a Release with the `.dmg`, `.app.tar.gz`, `.sig`, and `latest.json` (shape: `{ version, notes, pub_date, platforms: { "darwin-aarch64": { signature, url } } }`). There is no manual tagging step. Out of scope: Apple notarization, Windows/Linux/Intel, background polling beyond the launch check.

## Notes For Future Changes

- Avoid destructive filesystem deletion for worktrees unless there is an explicit confirmation path.
- Keep GitHub integration optional, additive, and `gh`-CLI-based; do not introduce app-managed OAuth or token storage.
- JIRA is `acli`-based by default (no stored tokens). The **one** deliberate exception is the optional JIRA REST layer: a user-pasted API token kept in the macOS Keychain (`native/src/jira_secret.rs`), never in SQLite, and never an OAuth flow. Keep it opt-in, additive, and degrade-to-`acli` when no token is present; don't broaden token storage beyond this.
- If adding persistent background sessions, introduce a deliberate session manager such as tmux/zellij instead of silently detaching child processes.
- If adding more terminal features, prefer extending `native/src/sessions/` and `src/TerminalPane.tsx` rather than mixing PTY concerns into dashboard components.
- When spawning any external CLI, follow [Spawning External CLIs](#spawning-external-clis-macos-gui-path): resolve the binary and set `PATH` to `process_util::augmented_path()`. A GUI-launched app's minimal PATH otherwise breaks node-based agents with `env: node: No such file or directory` (exit 127). OpenCode also has provider-specific fallback candidates under `~/.opencode/bin/opencode` and `~/bin/opencode`.
- The current icon is a simple generated placeholder and can be replaced later with proper app assets.
