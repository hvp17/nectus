# Nectus Desktop

Nectus Desktop is a Mac-first Tauri 2 app for coordinating parallel AI coding
work across local git projects and optional git worktrees.

It is local-first. Projects, tasks, agent profiles, session state, review-loop
history, and settings are stored in the local SQLite database created by the
desktop app. The frontend does not call git or shell commands directly; OS,
git, SQLite, and PTY work lives in the Rust backend.

## Features

- Add existing local git repositories as Projects.
- Group projects into named Workspaces (VSCode-workspace style) and filter Mission
  Control and the project rail to the repos you're focused on.
- Create cross-repo Tasks that span several of a workspace's repos: one agent runs
  across sibling worktrees (one per repo, each on its own branch).
- Create Tasks against a project in direct-edit mode or with a new git worktree;
  blank worktree branch names become generated `task-...` branches.
- Launch Codex, Claude, Gemini, OpenCode, or custom CLI agent profiles in an
  embedded terminal.
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
- Resume Codex, Claude, and OpenCode sessions when a saved session id is
  available.
- Track task status across `Planned`, `In progress`, `Review`, and `Done`.
- Drag tasks between board columns to update status.
- Show saved review status on task cards.
- Surface running, dirty, finished, review, and needs-input counts.
- Watch Codex session JSONL, Claude hooks, and OpenCode local server status for
  finished or input-needed events where each provider exposes them.
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

The desktop build script enables Rust incremental compilation for faster
repeat release builds while still producing the normal app and DMG bundles.

Expected release outputs:

```text
native/target/release/bundle/macos/Nectus Desktop.app
native/target/release/bundle/dmg/Nectus Desktop_0.1.0_aarch64.dmg
```

## Releases & Auto-Update

Nectus ships an in-app auto-updater built on the Tauri 2 updater plugin. It
targets Apple Silicon (`aarch64`) only and reads releases directly from the
public repository at `github.com/hvp17/nectus`, so no GitHub token is needed.
Update integrity is secured by minisign signatures, independent of Apple
code-signing.

### One-time maintainer setup

Generate a minisign updater keypair once and keep the private key out of the
repo:

```bash
pnpm tauri signer generate
```

Add the two halves as repository secrets so CI can sign updater artifacts:

- `TAURI_SIGNING_PRIVATE_KEY` — the generated private key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password set when generating it.

The matching public key is safe to commit and already lives in
`native/tauri.conf.json` under `plugins.updater.pubkey`; the updater verifies
every download against it.

### Cutting a release

`package.json` is the single source of truth for the app version: bump it, open a
PR, and merge to `main`. That's the whole flow — no manual tagging.

```bash
# bump only the "version" in package.json (e.g. via your editor), then:
git commit -am "chore(release): vX.Y.Z"
# open a PR and merge to main
```

`native/tauri.conf.json` reads the version from `package.json`
(`"version": "../package.json"`), and `native/Cargo.toml` is frozen at `0.0.0`
(its crate version is unused for app versioning), so you never touch those.

On every push to `main`, `.github/workflows/release.yml` reads
`package.json`'s version and, **only if no GitHub Release exists for it yet**,
builds the Apple-Silicon app on `macos-latest` (arm64), signs the updater
artifacts, creates the `vX.Y.Z` tag, and publishes a GitHub Release containing
the `.dmg`, the `.app.tar.gz`, its `.sig`, and `latest.json`. Merges that don't
change the version are no-ops.

### How installed copies update

Installed copies run one silent update check shortly after launch, and on
demand from Settings → About → "Check for updates". When a newer release is
found, Nectus offers a one-click install followed by an app relaunch.

### First-run Gatekeeper note

Nectus is not yet Apple-notarized, so the **first** download triggers a
Gatekeeper "cannot verify" / "damaged" warning. Clear it once by right-clicking
the app and choosing **Open**. Notarization is a future add-on and does not
affect update integrity, which is minisign-secured end to end.

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
- Codex JSONL tracking, OpenCode local server tracking, and current limitations.
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
                     Provider-specific Codex, Claude, Gemini, and OpenCode launch behavior
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
- `src/queries/`: TanStack Query server-state layer (query keys, hooks, cache helpers)
- `src/store/`: Zustand UI/runtime store (navigation, selection, session runtime, notifications)
- `src/AppRouter.tsx`: TanStack Router shell + routed views (memory history)
- `src/AppRouter.tsx`: `AppLayout` composes the shell from queries + store directly (no `useApp` god-hook); views/overlays are self-sufficient
- `src/hooks/use*Actions.ts`, `useComposer.ts`, `useSessionControls.ts`, `useShellBootstrap.ts`: focused, self-sufficient hooks that replaced the old `useApp` orchestration
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
  OpenCode local server watcher, and review-loop worker
- `native/src/sessions/agents/`: Codex, Claude, Gemini, and OpenCode command
  argument builders and provider-specific fallback locations
- `native/src/models.rs`: serializable backend/frontend contracts
