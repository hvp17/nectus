# Nectus Desktop Agent Guide

## Project Shape

Nectus Desktop is a Mac-first Tauri 2 desktop app for managing parallel Codex/Claude work across local git projects and optional git worktrees.

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
- forms: `Field`, `Input`, `Textarea`, `Select`, `RadioGroup`, `ToggleGroup`
- overlays: `Dialog`, `AlertDialog`, `Sheet`, `Tooltip`, `DropdownMenu`
- structure and display: `Card`, `Badge`, `Separator`, `Sidebar`, `ScrollArea`
- feedback and states: `Alert`, `Empty`, `Skeleton`, `sonner`

Add or update shadcn components through the CLI rather than copying component source by hand:

```bash
pnpm dlx shadcn@latest add @shadcn/<component>
```

When the CLI reports that existing UI files would be overwritten, inspect the impact first and only use `--overwrite` after explicit user approval. After adding a component, read the generated files and update app code to use the exported primitive APIs instead of preserving parallel custom implementations.

Keep custom React components focused on Nectus-specific composition, data flow, drag behavior, terminal behavior, and product workflow. Do not reimplement generic buttons, forms, empty states, badges, alerts, dialogs, menus, tooltips, cards, separators, or sidebars when shadcn provides the primitive.

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
- `docs/github-integration.md`: `gh` CLI connection model and pull request create/detect/status flows.
- `docs/jira-integration.md`: `acli` (Atlassian CLI) connection model, JQL board, auto-derived columns, work-item management, and local task↔story links.

## Backend Boundaries

Keep OS, git, SQLite, and PTY behavior in Rust.

Important backend files:

- `native/src/main.rs`: binary entry point that calls `nectus_desktop_lib::run`
- `native/src/lib.rs`: Tauri command registration, command bodies, and app setup
- `native/src/db/`: SQLite schema, row mapping, agent profiles, review loops, and persistence tests
- `native/src/git_ops.rs`: git repo/worktree validation and operations
- `native/src/github.rs`: `gh` CLI integration — connection status plus pull request create/detect/status parsing (no OAuth, no stored tokens)
- `native/src/jira.rs`: `acli` (Atlassian CLI) integration — connection status plus work-item search/view/transition/assign/comment with tolerant JSON parsing (no OAuth, no stored tokens)
- `native/src/process_util.rs`: shared command helpers — binary resolution (`resolve_executable`), child `PATH` augmentation (`augmented_path`), the install-dir source of truth (`third_party_bin_dirs`), and `command_error` stderr formatting. See [Spawning External CLIs](#spawning-external-clis-macos-gui-path).
- `native/src/sessions/`: PTY lifecycle, terminal event emission, Codex JSONL watching, agent command setup, and review-loop runtime
- `native/src/sessions/agents/`: provider-specific Codex, Claude, and Gemini command arguments and fallback locations
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
- `github_status`
- `create_github_pull_request`
- `github_pull_request_status`
- `detect_github_pull_request`
- `jira_status`
- `jira_search_board`
- `jira_get_work_item`
- `jira_transition_work_item`
- `jira_assign_work_item`
- `jira_comment_work_item`
- `set_task_jira_link`
- `list_agent_profiles`
- `upsert_agent_profile`
- `start_pair_loop`
- `run_pair_review`
- `stop_pair_loop`
- `get_task_review_loop`
- `list_task_review_runs`
- `create_pr_review`
- `list_pr_reviews`
- `get_pr_review`
- `rerun_pr_review`
- `delete_pr_review`
- `start_session`
- `resume_session`
- `stop_session`
- `resize_session`
- `send_session_input`
- `submit_session_input`
- `session_output_snapshot`

Events emitted by Rust:

- `session_output`
- `session_meta`
- `session_exited`
- `session_idle`
- `session_needs_input`
- `review_loop_updated`
- `pr_review_updated`

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
   node-based CLIs such as Codex `exec` `node` themselves, which must be on the
   child process's PATH. Set `command.env("PATH", process_util::augmented_path())`
   on the spawned command so nested executables resolve too. Missing this surfaces
   as `env: node: No such file or directory` with **exit status 127**.

**Rule:** whenever you spawn an external process — `std::process::Command` or
portable-pty `CommandBuilder` — resolve the binary with the helpers above *and*
set its `PATH` to `augmented_path()`. Apply any profile-provided env afterwards so
a profile's own PATH still wins. Current call sites:

- agent PTY sessions — `native/src/sessions/mod.rs`
- the reviewer launch shared by the task AI review loop and external PR reviews —
  `native/src/sessions/review_loop.rs`
- `gh` invocations resolve `gh` via `resolve_executable`; `gh` is a single static
  binary that spawns no node, so it needs resolution but not `augmented_path`
  (`native/src/github.rs`).
- `acli` invocations resolve `acli` via `resolve_executable`; like `gh` it is a
  single binary that spawns no node, so it needs resolution but not `augmented_path`
  (`native/src/jira.rs`).

## Frontend Boundaries

Keep React UI and command bindings in `src/`.

Important frontend files:

- `src/App.tsx`: app shell and top-level composition
- `src/hooks/useApp.ts`: app state, project/task/settings orchestration
- `src/hooks/useSessionEvents.ts`: subscribes to Rust session events (`session_output`, `session_meta`, `session_exited`, `session_idle`, `session_needs_input`)
- `src/hooks/useSessionCommands.ts`: start/resume/stop/resize/input session command bindings
- `src/hooks/useGithub.ts`: `gh` connection status and pull request create/detect/status orchestration
- `src/hooks/useJira.ts`: `acli` connection status, board items, auto-derived columns, and optimistic transition
- `src/hooks/useTaskReviewLoop.ts`: selected-task review-loop loading and event handling
- `src/hooks/useTaskCardPointerDrag.ts`: task-card pointer drag and ghost lifecycle
- `src/hooks/useTaskDeletion.ts`: task deletion workflow and deletion toasts
- `src/hooks/useSessionAttentionControls.ts`: session controls that clear task attention
- `src/TerminalPane.tsx`: xterm.js setup, terminal event listeners, input forwarding
- `src/api.ts`: typed Tauri command wrapper
- `src/types.ts`: frontend data contracts matching Rust serde output
- `src/components/`: board, task workspace, settings, GitHub panel, and modal UI
- `src/components/GitHubPanel.tsx`: task-inspector GitHub panel for connection state and pull request actions
- `src/components/JiraBoardPage.tsx`: global JIRA board view — JQL config, auto-derived columns, drag-to-transition
- `src/components/JiraWorkItemDialog.tsx`: work-item management (transition/assign/comment) and create-task-from-story
- `src/components/JiraPanel.tsx`: task-inspector panel for the linked JIRA story (display + detach)
- `src/components/settings/`: settings subcomponents and profile-draft helpers
- `src/test/testUtils.tsx`: shared frontend test helpers for providers, pointer events, DOM rects, and async deferrals
- `src/test/app*Tests.tsx`: focused App test groups registered by `src/App.test.tsx`
- `src/styles.css`: Tailwind imports, theme tokens, and global base rules
- `src/styles/`: focused CSS files imported by `src/main.tsx` for layout, settings, task board, detail, and forms

Do not call shell/git directly from the frontend. Add Rust commands instead.

Use the shadcn/UI Frontend Work rules above for all visible React UI changes.

## Product Defaults

Preserve these V1 decisions unless the user asks to change them:

- Operations dashboard is the primary UI.
- Projects are existing local git repos.
- Worktrees default to a sibling folder: `../<repo-name>-worktrees/<branch-name>`.
- Tasks can be direct-edit or worktree-backed; worktree is optional.
- Tasks and PR URLs are stored locally.
- GitHub integration runs through the local `gh` CLI; the app stores no GitHub tokens and runs no OAuth flow.
- Codex, Claude, Gemini, and custom agents are launched as configurable CLI commands.
- Embedded sessions are app-owned child processes.
- Closing the app stops owned sessions.

## Notes For Future Changes

- Avoid destructive filesystem deletion for worktrees unless there is an explicit confirmation path.
- Keep GitHub integration optional, additive, and `gh`-CLI-based; do not introduce app-managed OAuth or token storage.
- If adding persistent background sessions, introduce a deliberate session manager such as tmux/zellij instead of silently detaching child processes.
- If adding more terminal features, prefer extending `native/src/sessions/` and `src/TerminalPane.tsx` rather than mixing PTY concerns into dashboard components.
- When spawning any external CLI, follow [Spawning External CLIs](#spawning-external-clis-macos-gui-path): resolve the binary and set `PATH` to `process_util::augmented_path()`. A GUI-launched app's minimal PATH otherwise breaks node-based agents with `env: node: No such file or directory` (exit 127).
- The current icon is a simple generated placeholder and can be replaced later with proper app assets.
