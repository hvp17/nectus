# Nectus Desktop

Nectus Desktop is a Mac-first Tauri 2 app for coordinating parallel AI coding
work across local git projects and optional git worktrees.

It is local-first. Projects, tasks, agent profiles, session state, review-loop
history, and settings are stored in the local SQLite database created by the
desktop app. The frontend does not call git or shell commands directly; OS,
git, SQLite, and PTY work lives in the Rust backend.

> **New to the codebase? Start with [docs/architecture.md](docs/architecture.md)** —
> the one-page model of how the five layers connect, a traced request lifecycle, and
> a "where does X live" table. The full [documentation index](docs/architecture.md#documentation-index)
> lists every doc and what it owns. (`CLAUDE.md` is a symlink to `AGENTS.md`, the
> agent operating guide.)

## Features

- Add existing local git repositories as Projects.
- Group projects into named Workspaces (VSCode-workspace style) and open an
  aggregated workspace board scoped to the repos you're focused on.
- Create cross-repo Tasks that span several of a workspace's repos: one agent runs
  across sibling worktrees (one per repo, each on its own branch).
- Create Tasks against a project in direct-edit mode or with a new git worktree;
  blank worktree branch names become generated `task-...` branches.
- Launch Codex, Claude, Antigravity, OpenCode, or custom CLI agent profiles in an
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
- Manage a global JIRA board: pick a project from a dropdown and toggle filters —
  no JQL to write — then browse stories in status columns, drag to transition,
  assign and comment, and create a task from a story with a local-only task↔story
  link. Connect with a JIRA Cloud **API token** (Settings → JIRA, kept in the macOS
  Keychain; recommended, no other tools needed) — which also unlocks legal
  transitions, every status column, the board status filter, and Sprint view — or
  fall back to the Atlassian CLI (`acli` installed + `acli jira auth login`). See
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
native/target/release/bundle/dmg/Nectus Desktop_<version>_aarch64.dmg
```

The `<version>` in the DMG name is the current `package.json` version.

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

By default Nectus is ad-hoc code-signed (`bundle.macOS.signingIdentity: "-"`)
and not Apple-notarized, so the **first** download triggers a Gatekeeper
"unidentified developer" warning. Clear it once by right-clicking the app and
choosing **Open** (or System Settings → Privacy & Security → **Open Anyway**).

Releases become Developer ID signed **and notarized** (no Gatekeeper prompt)
once the Apple credentials are configured as repo secrets — `APPLE_CERTIFICATE`
(base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID`;
`release.yml` picks them up automatically and falls back to ad-hoc signing
when they are absent.

If macOS still reports the app as **"damaged and can't be opened"**, the
download's quarantine flag is the cause — strip it once with:

```bash
xattr -dr com.apple.quarantine "/Applications/Nectus Desktop.app"
```

Notarization is a future add-on and does not affect update integrity, which is
minisign-secured end to end.

## Verification

Run the standard checks before calling a change complete:

```bash
pnpm verify
```

`pnpm verify` runs the frontend tests, frontend build, Rust tests, Rust format
check, and all-target Clippy lint gate.

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
src/                 React app: components, hooks, queries/ (TanStack Query),
                     store/ (Zustand), api.ts (typed Tauri wrapper), styles/
src/components/      Mission Control, board, task workspace, settings, GitHub/JIRA
                     panels, the icon rail, and the inline composer UI
src/test/            Shared Vitest and Testing Library helpers
native/src/          Rust Tauri backend: lib.rs (commands), db/ (SQLite),
                     git_ops/ (git + worktrees), sessions/ (PTY runtime),
                     github.rs, jira*.rs, process_util.rs, models/
native/src/sessions/agents/
                     Provider-specific Codex, Claude, Antigravity, OpenCode launch behavior
native/capabilities/ Tauri permission capability files
docs/                Project documentation (see the index below)
```

For the connected picture of how these layers talk to each other — and a
**"where does X live"** lookup table — see
[docs/architecture.md](docs/architecture.md). The authoritative, per-file backend
and frontend maps live in [AGENTS.md](AGENTS.md) (the "Backend Boundaries" and
"Frontend Boundaries" sections); they are the single source of truth for file
ownership, so this README does not duplicate them.

## Documentation

| Concern | Doc |
|---|---|
| **How it all connects** (start here) | [docs/architecture.md](docs/architecture.md) |
| Agent operating rules + file maps | [AGENTS.md](AGENTS.md) (= `CLAUDE.md`) |
| Feature behavior | [docs/features.md](docs/features.md) |
| Persistence, commands/events, debugging | [docs/tracking-and-debugging.md](docs/tracking-and-debugging.md) |
| Codex session JSONL | [docs/codex-session-jsonl.md](docs/codex-session-jsonl.md) |
| GitHub integration | [docs/github-integration.md](docs/github-integration.md) |
| JIRA integration | [docs/jira-integration.md](docs/jira-integration.md) |
