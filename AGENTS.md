# Nectus Desktop Agent Guide

> `CLAUDE.md` is a symlink to this file — they are the same guide. For the
> connected layer model (how frontend ↔ commands ↔ SQLite/ACP/CLIs ↔ events fit
> together), a traced request lifecycle, and a **"where does X live"** table, read
> [`docs/architecture.md`](docs/architecture.md) first. This file owns the
> coding-session rules and the authoritative per-file **backend & frontend maps**.

## Project Shape

Nectus Desktop is a Mac-first Tauri 2 desktop app for managing parallel Codex, Claude, and OpenCode work across local git projects and optional git worktrees.

- Frontend: React + TypeScript + Vite in `src/`
- Desktop backend: Rust + Tauri in `native/`
- Local storage: SQLite through Rust-side `rusqlite`
- Agent runtime: ACP over stdio for both chat and reviews; reviewer output renders
  in a read-only `xterm.js` pane
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
- Update `docs/jira-integration.md` when the JIRA connection model (API token / REST endpoints), the board JQL/columns, work-item management, or task↔story link behavior changes.
- Update `AGENTS.md` itself when development workflow, verification gates, important paths, or coding-session rules change.
- Keep documentation concrete and repo-grounded. Prefer exact commands, file paths, table names, event names, and known caveats over general prose.
- Do not add placeholder docs such as `TODO`, `TBD`, or speculative behavior unless it is clearly marked as a future idea outside current behavior.
- `.claude/` is a local working area for Claude settings and nested worktrees; keep it ignored and never stage files from inside it. Vite and Vitest also exclude it so copied worktrees do not wake the dev server or duplicate the test suite.
- `design-mockups/` is local scratch output for Claude Design prototypes; keep it ignored unless the user explicitly asks to commit a specific design artifact.
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
2. **Recreate, don't paste.** Rebuild each surface with the installed shadcn primitives in `src/components/ui/*` plus Tailwind utilities in the component JSX. There is **no per-surface CSS layer anymore** — translate the prototype's `nx-` classes to token-consuming utilities (`bg-card`, `text-muted-foreground`, `ring-border`, `data-[state=…]:` variants) directly in the components.
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

Use this when working on layout, React state, styling, and non-Tauri UI behavior. In browser-only mode, Tauri commands are unavailable, so repo/worktree operations will only work inside the Tauri app. To make every page previewable there, `src/lib/browserSeed.ts` seeds realistic read-path data (projects, cross-project tasks with attention states, JIRA board, PR reviews incl. a consensus example) — gated on `isBrowserPreview` (outside Tauri **and** outside the test runner), so the real backend and the test suite are unaffected. Live ACP chats and reviewer runs still need the Tauri app.

Do not start a dev server after making changes unless the user explicitly asks you to run one. The user decides when to launch `pnpm dev`, `pnpm desktop:dev`, or any other long-running local server.

Run the full desktop app locally:

```bash
pnpm desktop:dev
```

Use this for validating:

- adding existing git repos
- creating worktrees
- launching Codex/Claude/OpenCode ACP chats
- chat permission/input/output
- app-owned ACP process cleanup

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
- `docs/jira-integration.md`: the API-token connection model, the REST endpoints used, JQL board, status columns, work-item management, and local task↔story links.
- `docs/superpowers/`: dated design archive (historical intent, not current truth).

## Backend Boundaries

Keep OS, git, SQLite, and ACP child-process behavior (both chat and reviews) in Rust.

Important backend files:

- `native/src/main.rs`: binary entry point that calls `nectus_desktop_lib::run`
- `native/src/lib.rs`: Tauri command registration, command bodies, and app setup; `run()` also registers `tauri_plugin_process::init()` and `tauri_plugin_updater::Builder::new().build()` for the auto-updater. `native/tauri.conf.json` carries `bundle.createUpdaterArtifacts: true` plus a `plugins.updater` block (endpoint `https://github.com/hvp17/nectus/releases/latest/download/latest.json` + a base64 minisign pubkey, safe to commit), and `native/capabilities/default.json` grants `updater:default` + `process:allow-restart`
- `native/src/db/`: SQLite access split by domain into `impl Database` blocks — `mod.rs` (connection open/pragmas — `configure_pragmas` sets **WAL + `synchronous=NORMAL` + `busy_timeout`** for the on-disk DB — repos, the `now`/`generated_branch_name` helpers), `tasks.rs` (single- and cross-repo task CRUD plus `clear_legacy_active_sessions` for PTY-era markers), `settings.rs`, `agent_profiles.rs`, `review_loops.rs`, `pr_reviews.rs`, `workspaces.rs` (durable repo groups: CRUD with transactional `workspace_repos` membership); `schema.rs` (create/migrate), `rows.rs` (row mapping), and `tests.rs` (persistence tests). **Worktree creation is deliberately split so the network `git` never runs under the global DB lock**: `worktree_plan`/`cross_repo_plan` resolve branch+path (fast, DB-only), the command then creates the worktree(s) off-lock (`CrossRepoPlan::create_worktrees` fans them out concurrently), and `insert_task`/`insert_cross_repo_task` persist the rows under a brief lock (`tasks.*` stays the primary repo; per-repo state in the `task_repos` child table). Task **deletion** is split the same way — `plan_task_deletion` (DB-only: validate + collect worktrees), `TaskDeletionPlan::remove_worktrees` (off-lock git: all-or-nothing dirty check, then remove + prune + branch cleanup), `delete_task_row` (DB-only) — so `git worktree remove` never runs under the lock. The all-in-one `create_task_record`/`create_cross_repo_task`/`delete_task` wrappers are test-only (`#[cfg(test)]`). **Task reads are DB-only**: `task_by_id`/`list_tasks` never shell out to `git status`; worktree dirtiness is filled in off-lock by the command layer (`fill_task_dirtiness` in `lib.rs`), so no DB method runs a subprocess under the lock
- `native/src/git_ops/`: git repo/worktree validation and operations — `mod.rs` (the `git_output`/`git_output_allowing_codes` helpers, repo/branch validation, worktree-root pattern, remote resolution, worktree create/remove/branch lifecycle, `is_dirty`) and `diff.rs` (the cohesive task-diff sub-domain: `resolve_diff_base`, `diff_summary`, `diff_file`, re-exported from `mod.rs`). Worktree creation is tuned for latency: the default branch is resolved from the **local** `refs/remotes/<remote>/HEAD` symref (`resolve_default_branch`, no network) and only falls back to `ls-remote` when unset, and the fetch pulls **only that branch, `--no-tags`** (`fetch_default_branch`) instead of every ref. `is_dirty` runs `git status` on a worker thread with a 10s ceiling (`IS_DIRTY_TIMEOUT`) so a stuck status (e.g. a hung fsmonitor hook) can never wedge a caller or the DB lock. Cross-repo worktrees are created concurrently (scoped threads) via `CrossRepoPlan::create_worktrees`. On task deletion, worktree removal also prunes stale admin entries (`prune_worktrees` → `git worktree prune`) and deletes the now-orphaned **local** `task-*` branch (`cleanup_task_branch` → `git branch -D`, best-effort). Local-only; the remote branch/PR is never touched, so pushed work is safe and only never-pushed local commits go with the task
- `native/src/github.rs`: `gh` CLI integration — connection status, pull request detect/status parsing (incl. the per-check GitHub Actions/CI drill-down parsed from one `gh pr view` `statusCheckRollup`), `comment_on_pull_request` for posting a review back, and `resolve_repo_for_owner_repo` (match a PR URL's `owner/repo` to a known project via each repo's remote — one git subprocess per candidate, so callers run it off the DB lock); no OAuth, no stored tokens. PR **writes** (create/merge/mark-ready/close) are agent-driven, not `gh`-shell-out from Rust — the agent runs `git`/`gh` in the worktree (see `src/hooks/useGithubShipActions.ts`); the old deterministic write helpers/commands were removed once the UI stopped calling them
- `native/src/jira.rs`: shared JIRA domain helpers — pure, no shell-outs/HTTP. The tolerant payload parsers (`parse_work_items`/`parse_work_item`/`parse_projects` parse the raw v3 payloads: `/search/jql` pages, `/project/search`, issue views, Agile issues; ADF descriptions flattened by `collect_adf_text`) and the structured-config JQL builders (`build_board_jql`, incl. the `status in (...)` and `parent = "<epic>"` filter clauses, so the UI never types JQL; `build_epics_jql` for the epic picker). Golden fixtures in `native/src/jira_fixtures/` pin the live payload shapes
- `native/src/jira_rest.rs`: the JIRA Cloud REST client (`ureq` with the `native-certs` feature, so TLS trust comes from the macOS Keychain — corporate TLS-inspection roots work; Basic auth) — the app's only JIRA integration, gated on the user's API token. Core API: `list_projects` (`GET /project/search`), the paginated `search` (`POST /search/jql` + `nextPageToken`; the old `/search` endpoint was removed by Atlassian), `view` (`GET /issue/{key}`), `assign` (`PUT .../assignee` with `@me`/email/display-name → account-id resolution via `/myself` + `/user/search`, `pick_account_id`), `comment`/`create` (plain text wrapped in minimal ADF by `text_to_adf`, the inverse of `jira::collect_adf_text`), and the fixture-tested parsers `parse_transitions` / `parse_project_statuses` (with `verify` (`/myself`), `list_transitions`, `project_statuses`, `perform_transition`) — plus the Agile-API sprint layer under `/rest/agile/1.0` (`find_scrum_board`, `parse_sprints`, and the `sprint_board` orchestrator that returns active/future sprints + backlog as `JiraSprintLane`s, issues carrying their epic). Commands reach it through `jira_rest_call` in `lib.rs` (credentials from settings + Keychain)
- `native/src/jira_secret.rs`: macOS Keychain store for the JIRA API token (`keyring`; service = the app identifier, account = `jira-api-token:{site}`). The token never touches SQLite — only the non-secret site/email persist in `app_settings`
- `native/src/process_util.rs`: shared command helpers — binary resolution (`resolve_executable`), child `PATH` augmentation (`augmented_path`), the captured **login-shell environment** (`login_shell_env`, run once and cached: a single `$SHELL -lic 'env'` dump that feeds both the seed env for spawned children — `login_shell_environment`, so provider keys like `OPENAI_API_KEY` reach GUI-launched agents — and the login-shell PATH — `login_shell_path`, so any install prefix like `~/homebrew`, mise/asdf/volta shims, `~/bin` is found, not just the fixed `third_party_bin_dirs`), the install-dir source of truth (`third_party_bin_dirs`), and `command_error` stderr formatting. See [Spawning External CLIs](#spawning-external-clis-macos-gui-path).
- `native/src/diagnostics.rs`: the in-app diagnostics log — a `tracing` fmt layer (added alongside the console layer in `init_tracing`) that mirrors every captured log line into a bounded in-memory ring buffer **behind its own mutex, independent of the global DB lock**, and streams each new line to the UI as a `diagnostic_log` event. `buffered_logs()` backs the `get_diagnostic_logs` command (panel backfill); `attach_app_handle` (called in `setup`) turns on live streaming. Being off the DB lock is the point: the log keeps updating even while a command is stuck holding that lock, so the panel shows where the app hangs
- `native/src/sessions/`: ACP chat and reviewer runtimes. `acp.rs` owns provider descriptors and normalized ACP data (`list_acp_providers` exports descriptor ids, launch argv, and coarse capability states); `acp_manager.rs` starts ACP processes, sends ACP v1 `initialize` with Nectus client info and no filesystem/terminal capabilities, uses `session/new` plus runtime-capability-gated `session/load` resume, passes cross-repo `additionalDirectories` and profile `NECTUS_ACP_MCP_SERVERS_JSON` MCP servers into session setup, builds prompt content with capability-gated images, ACP resource links, and embedded task context, persists transcript/checkpoint/permission/runtime metadata, and emits `session_chat`, `session_chat_usage`, `session_chat_runtime`, and `chat_session_exited`. It also handles graceful turn cancel (`session/cancel`) plus session mode/config control; `acp_stop_chat` remains the hard child-process stop. ACP launch layers login-shell env, augmented PATH, descriptor env, then profile env. **ACP is the single agent-driving mechanism for both chat and reviews** — the reviewer no longer spawns provider CLIs or parses per-provider `--json`. `review_runtime.rs` is the headless ACP review driver with two observers over one shared scaffold (`drive_review_turn`): `run_review(...)` streams the agent's message to a single PR review's read-only Terminal pane (`pr_review_output`), used by `pr_review.rs` + `pr_consensus.rs`; `run_inline_review(...)` folds every ACP update into a `TurnAccumulator` and emits a `Subagent` chat message, used by the **inline task `/review`** path. Each runs ONE headless ACP turn (initialize → `session/new` or `session/load` → one prompt → stream → stop). The task `/review` command (`acp_start_review` → `sessions::spawn_inline_review`) reads the task's configured reviewer from the `review_loop` row, runs the inline review in the worktree, records the run, and emits `review_loop_updated` so the facts-rail review card + task board refresh. `review_loop.rs` is now just the shared prompt builders (`build_review_prompt`/`build_review_continuation_prompt`) + `verdict_from_token` + `UNCLEAR_REVIEW_ERROR` (the read-only task Review pane and its `run_pair_review`/`spawn_task_review` run path were retired in favor of `/review`; the reviewer SELECT persists via `start_pair_loop`). With no human present the driver auto-approves every permission request and captures the final review text + a validated verdict with a one-shot self-repair (a second same-session prompt asking for just the verdict block when the first turn omits a parseable one). Resume is ACP-native: `session/load` is sent only when the agent advertises the `loadSession` capability (no per-`AgentKind` table). Custom agents have no ACP descriptor and are rejected with a clear error — only ACP providers (Claude, Codex, OpenCode, Antigravity) can review. The single + consensus PR runtimes share one ephemeral-worktree scaffold (`pr_worktree.rs`: unique per-review branch/path + guaranteed teardown); consensus fans reviewers out concurrently via `futures::future::join_all`. The agent-verdict contract is shared app-wide in `verdict.rs`: a reviewer ends its message with a fenced ` ```json ` block carrying `{"verdict": "clean|blockers|feedback"}`, parsed by `parse_verdict_block` (last valid block wins, stripped from the human-facing text; no natural-language fallback). `pr_verdict.rs` (`pr_verdict_from_token`, PR reviews) and `review_loop.rs` (`verdict_from_token`, task loop) are thin adapters mapping the `VerdictToken` to their own domain enums
- `native/src/models/`: shared serializable data types, split by domain (`error`, `task`, `review`, `agent`, `github`, `jira`, `settings`, `workspace`) and re-exported flat from `mod.rs`, so every `crate::models::Foo` path still resolves

All Tauri commands are registered in `generate_handler!` in `native/src/lib.rs`,
grouped by domain: repos & settings, tasks & workspaces, task diff, GitHub PRs,
JIRA (REST, token-gated), agent profiles, the task AI review loop, external PR
reviews, and ACP chat. Rust emits eight events — `review_loop_updated`,
`session_chat`, `session_chat_usage`, `session_chat_runtime`,
`chat_session_exited`, `pr_review_output`, `pr_review_updated`, and `diagnostic_log` (one line per
captured backend `tracing` record, for the Settings → Diagnostics panel).

The **authoritative, exhaustive command and event reference** (with each one's
purpose and source) lives in
[`docs/tracking-and-debugging.md`](docs/tracking-and-debugging.md) — keep that the
single source of truth rather than re-listing commands here.

## Spawning External CLIs (macOS GUI environment)

A macOS app launched from Finder/Dock (or the packaged `.app`) inherits only a
minimal environment — PATH `/usr/bin:/bin:/usr/sbin:/sbin`, and **none of the
variables the user exports in their shell profile/rc** (provider API keys like
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, etc.). This breaks externally-spawned CLIs
in three distinct ways. All are handled in `native/src/process_util.rs`, which
captures the user's login-shell environment once (`login_shell_env` — a single
`$SHELL -lic 'env'` dump, cached, 3s-bounded, stderr discarded; sources
`.zprofile`/`.zshrc`). That one capture feeds both the seed env and the PATH
layers below.

Binary resolution searches three layers in order: the process PATH, the **captured
login-shell PATH** (`login_shell_path`, derived from the env dump; picks up any
install prefix — a no-sudo `~/homebrew`, `mise`/`asdf`/`volta` shims, `~/bin`, …),
then the fixed `third_party_bin_dirs` backstop (`/opt/homebrew/bin`,
`/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, …). The login-shell layer
handles install locations the fixed list can't enumerate; `third_party_bin_dirs`
remains the source of truth for the common defaults:

1. **Finding the CLI itself.** Resolve the binary with `resolve_executable` (for
   `gh` and general tools) or `resolve_agent_command` (for agent profiles); both
   search the layers above (PATH → login-shell PATH → common install dirs).
2. **Tools the CLI then spawns.** A resolved absolute path is not enough —
   node-based CLIs such as Codex and OpenCode exec `node` themselves, which must be on the
   child process's PATH. Set `command.env("PATH", process_util::augmented_path())`
   on the spawned command so nested executables resolve too. Missing this surfaces
   as `env: node: No such file or directory` with **exit status 127**.
3. **Provider keys the CLI reads from the env.** Node-based agents read
   `OPENAI_API_KEY` and friends straight from the environment, which a GUI launch
   lacks. Seed the child with `process_util::login_shell_environment()` (the
   login-shell env minus PATH) so a GUI launch behaves like a terminal launch.
   Missing this surfaces as the reviewer/agent reporting **"API key is missing"**.

**Rule:** whenever you spawn an external process with `std::process::Command`,
resolve the binary with the helpers above, seed the child env with
`login_shell_environment()`, *and* set its `PATH` to
`augmented_path()`. Apply any profile-provided env last so a profile's own
env/PATH still wins. Current call sites:

- ACP chat processes — `native/src/sessions/acp_manager.rs`
- the headless ACP review driver shared by the task AI review loop and external PR
  reviews — `native/src/sessions/review_runtime.rs` (`run_review`), which launches
  the agent via the shared `launch_argv_for_profile` with the same login-shell
  env/PATH layering as chat
- `git` invocations in repo/worktree operations resolve `git` via
  `resolve_executable` and set `PATH` to `augmented_path`
  (`native/src/git_ops/mod.rs`). Network git (worktree-creation `ls-remote`/`fetch`)
  also needs auth parity with a terminal: `git_command` seeds the
  `login_shell_environment()` (so `SSH_AUTH_SOCK` and the user's git/ssh config are
  present) and forces non-interactive auth (`GIT_TERMINAL_PROMPT=0`,
  `GCM_INTERACTIVE=never`, and a batch-mode `GIT_SSH_COMMAND` unless the user set
  one) so a GUI launch never hangs on a credential/passphrase prompt at a
  non-existent tty — which, under the global DB lock, would freeze the whole app.
- `gh` invocations resolve `gh` via `resolve_executable`; `gh` is a single static
  binary that spawns no node, so it needs resolution but not `augmented_path`
  (`native/src/github.rs`).

## Frontend Boundaries

Keep React UI and command bindings in `src/`.

Important frontend files:

- Frontend infrastructure (the three layers the shell composes):
  - `src/queries/`: the **TanStack Query** server-state layer — `queryClient.ts` (per-mount client factory + a `QueryCache` error handler that surfaces `meta.surfaceErrors` reads), `keys.ts` (the key catalog), `cache.ts` (`makeCacheSetter`, a `setState`-shaped writer backed by the cache), `optional.ts` (the dynamic optional-query helper for "no id yet" reads that must not create placeholder cache keys), `core.ts` (bootstrap read hooks: repos/workspaces/tasks/agentProfiles/settings), and per-domain query hooks (`github.ts`, `jira.ts`). **Every data hook is Query-backed**: `useGithub`, `useJira`, `usePrReviews`, `useTaskReviewLoop`, and `useTaskDiff` read/write the cache (no `useState`/`useAsyncEffect` loading boilerplate, no request-ordering refs). All server/command reads and cache writes go through here, not component state.
  - `src/hooks/useEventBridge.ts`: the single, **mount-once** Tauri event bridge (mounted in `AppLayout`). It owns chat/review/PR subscriptions (`session_chat`, `session_chat_usage`, `session_chat_runtime`, `chat_session_exited`, `review_loop_updated`, `pr_review_updated`) and routes each event to the query cache (tasks, chats, review loop/runs, PR reviews) or the Zustand store (`liveLines`/`taskAttention`/toast/message). Each channel delegates the Tauri `listen` lifecycle to `useTauriEvent`, so subscriptions are independent and share the same late-unlisten/error handling. Because events are centralized, the domain hooks are pure cache consumers callable per-component. `pr_review_output` (per-component live stream) stays in `usePrReviews` (the selected single review's live stdout).
  - `src/store/`: the **Zustand** UI/runtime store — `appStore.ts` composes concern-split slices (`navigation`, `selection`, `composer`, `runtime`, `sessionRuntime`, `notification`); `setState.ts` makes setters `SetStateAction`-compatible drop-ins for `useState`. Owns the shell state that is NOT server state: `currentView`/`activeWorkspaceId`, selection (repo/task/agent), the New Task composer draft, the push-driven `liveLines`/`taskAttention`, `deletingTaskIds`, `message`/`taskToast`, and the global `busy` flag. (Per-domain selection like the open PR-review / JIRA item lives in those domain hooks/views.)
  - `src/AppRouter.tsx`: the persistent **shell** — `AppLayout` composes the shell's data directly from queries + the store (there is no `useApp` god-hook anymore), runs `useEventBridge` + `useShellBootstrap` once, and renders **either an overlay** (`ComposerOverlay`, the open task's `TaskWorkspaceOverlay`, or the workspace manager) **or the current view directly** off the store's `currentView` — a plain switch, no router (the desktop shell has no URL bar, so view navigation is synchronous). Mission Control and the project/workspace boards stay eager; secondary rail views (settings, PR reviews, JIRA), on-demand overlays, and the command palette are `React.lazy` chunks behind `Suspense` boundaries. The leaf views are **self-sufficient** — each reads its own queries/store/domain-hooks; only the cross-cutting `openTask` / `openCreateTaskModal` / `appUpdate` flow through a small React context. (Despite the filename, there is no `@tanstack/react-router`; the desktop shell navigates via a plain `currentView` switch, not a router.)
- `src/App.tsx`: thin root that mounts the app-wide providers (`QueryClientProvider` + `TooltipProvider`) with a fresh `QueryClient` per mount for test isolation, then renders `<AppLayout/>`; all shell/view logic lives in `src/AppRouter.tsx`
- `src/components/IconRail.tsx`: always-collapsed icon-only rail (52px, icon buttons under the brand "N" mark; the width lives in `AppRouter`'s frame grid). Each button is icon-only with a shadcn `Tooltip` naming it and keeps its `aria-label`; the Mission Control icon carries a corner needs-input badge. Hosts a foot "New task" icon button (`onCreateTask`/`canCreateTask`) that opens the composer from any view
- `src/components/ProjectPanel.tsx`: the persistent navigator panel, built on the shadcn `Sidebar` primitives in embedded mode (`SidebarProvider` + `collapsible="none"`; the 16rem column is owned by `AppRouter`'s frame grid) — **Projects** and **Workspaces** sections, each opening its own board (project board or aggregated workspace board), with each scope's in-flight agents nested inline as compact `SidebarAgentRow` cards and a workspace ⓘ info card (Popover) listing member projects; replaces both the old running-agents popup and the scoped project rail. Subscribes to the hot `liveLines`/`taskAttention` store fields itself (they are NOT threaded through `AppLayout`, which must not re-render per agent output line). Persistent on Mission Control, project board, workspace board, and an open task's details; hidden only when the composer or workspace manager is open
- `src/components/SidebarAgentRow.tsx`: compact in-flight agent card rendered inside the navigator panel's nested agent lists; shows agent logo, branch, latest activity line, elapsed time, and click-to-focus action. Shares the `nx-fly-row*` CSS vocabulary
- `src/lib/sidebarAgents.ts`: pure helper — buckets in-flight agents (`ACTIVE_AGENT_STATES`) by repo (`byRepo`) and by workspace (`byWorkspace`), plus `dominantState` (most urgent state in a row list)
- `src/lib/agentProfiles.ts`: pure helper for choosing available agent-profile defaults and reviewer fallbacks across shell bootstrap, composer/JIRA launches, task reviews, and PR reviews
- `src/lib/taskRepos.ts`: pure cross-repo scope helpers (`isCrossRepoTask`, `taskRepoPrUrl`, `taskRepoWorktreePath`, `taskRepoName`) — one place that knows the primary repo's state lives on the task row and a non-primary member's on its `taskRepos` entry. Drives the per-repo Diff/GitHub scope (`TaskRepoScopePicker` in `src/components/taskWorkspace/`)
- `src/components/ProjectRowMenu.tsx`: hover ⋯ menu on a sidebar project row — rename (display name only) and remove (backend-refused while tasks exist; never touches disk)
- `src/lib/browserPreview.ts`: the `isBrowserPreview` gate plus the two tiny store-creation seeds; the bulky fixtures in `src/lib/browserSeed.ts` are a **lazy chunk** behind a dynamic import in `api.ts`, so the desktop bundle never ships them
- `src/components/WorkspaceManager.tsx`: de-modaled inline composer to create/rename/re-scope/delete workspaces with a per-repo checklist
- `src/components/MissionControl.tsx`: cross-project, attention-first triage home (the default view), grouped needs_you → running → review → done → idle
- `src/lib/agentState.ts`: maps a task + attention to its cross-project state, latest line, and elapsed time (shared by Mission Control and the board)
- Frontend action/composition hooks (what replaced the `useApp` god-hook — each is self-sufficient, reading the store + query cache directly, callable from any component):
	  - `src/hooks/useTaskActions.ts` (status/rename/JIRA-link), `useTaskDeletion.ts` (delete; `deletingTaskIds` lives in the store), `useWorkspaceActions.ts` (workspace CRUD), `useSettingsActions.ts` (save settings/agent profile), `useProjectActions.ts` (add repo), `useSidebarCollapse.ts` (fold a project's/workspace's nested agent list — optimistic repos/workspaces cache write + `set_repo_collapsed`/`set_workspace_collapsed` persist, revert on failure), `useJiraToken.ts` (JIRA REST token connect/disconnect), `useShellBootstrap.ts` (boot-time default agent/repo selection + drop-deleted-workspace, via `getState()`).
  - `src/hooks/useComposer.ts`: the New Task composer — the draft lives in the store's composer slice; this owns the create-task submit (single / worktree / cross-repo routing) and "create from JIRA story". `activeWorkspaceId` is the **focused** workspace (drives the workspace board), not a global filter; the composer's cross-repo mode is the separate `newTaskWorkspaceId` toggle, switchable to any eligible workspace.
	  - `src/components/TaskWorkspaceOverlay.tsx`: assembles every `TaskWorkspace` prop from per-task hooks (`useGithub`, `useTaskReviewLoop`, inline PR-create/start-review), keeping `TaskWorkspace` a pure presentational component.
- `src/hooks/useGithub.ts`: **read-only** GitHub state — `gh` connection status, the live PR-status query, existing-PR detection/backfill, and the open-PR auto-refresh (interval + window focus, off for terminal PRs). The PR **write** actions moved out (see below)
- `src/hooks/useGithubShipActions.ts`: the four PR write actions (create/merge/mark-ready/close), now **agent-driven** — each submits a prompt (from `src/lib/githubAgentPrompts.ts`) into the task's ACP chat via `acp_send_prompt` so the agent runs `git`/`gh`, authors the PR body, and rebases/resolves conflicts itself; declines with guidance when no ACP-capable profile is selected. Wired in `TaskWorkspaceOverlay`. `GitHubPanel`/`PullRequestActions` are presentational and unchanged
- `src/lib/githubAgentPrompts.ts`: pure builders for the create/merge/mark-ready/close prompts (the single iteration surface for shipping behavior)
- `src/hooks/useJira.ts`: the JIRA token connection (`restStatus`/`restConnected`, `setApiToken`/`clearApiToken`), board items, the project status set (`projectStatuses`), optimistic transition, and `deriveColumns` (full status skeleton incl. empty columns, narrowed by the status filter; derived from results while the set loads)
- `src/hooks/useTaskReviewLoop.ts`: selected-task review-loop **config** (reviewer profile) + run-history loading, backed by the query cache. Reviews run inline via `/review` in chat (a `Subagent` block), not a read-only pane; the hook no longer streams `review_output`
- `src/hooks/useTaskDiff.ts`: task diff data — summary load, lazy per-file patches, and manual refresh
- `src/hooks/useTaskCardPointerDrag.ts`: task-card pointer drag and ghost lifecycle
- `src/hooks/useTaskDeletion.ts`: task deletion workflow and deletion toasts
- `src/api.ts`: typed Tauri command wrapper
- `src/types.ts`: frontend data contracts matching Rust serde output
- `src/components/`: sidebar, Mission Control, board, task workspace (workflow ribbon + facts rail), settings, GitHub panel, and the inline composer/side-panel UI (no modals/dialogs for create-task or JIRA work items)
- `src/components/TaskWorkspace.tsx`: selected-task workspace orchestrator — owns the derived workflow/review state and composes the stage and facts rail. The stage has a `Chat | Diff` toggle, with ACP chat or the diff getting the full stage when active. The workflow ribbon's Review step keeps the reviewer SELECT (persists the choice via `onConfigureReviewer` → `start_pair_loop`) and hints to run `/review` in chat; reviews run as inline `Subagent` blocks there, not a read-only pane
- `src/components/taskWorkspace/`: the workspace's presentation pieces — `TaskWorkspaceStage` (header, workflow ribbon, stage body), `TaskWorkspaceFactsRail` (inspector: metadata, GitHub/JIRA panels, review card, brief, delete), and the leaf helpers `ActionBar`, `TaskStatusBadges`. `TaskWorkspaceStage` lazy-loads the active stage pane (`ChatPane` or `TaskDiffView`; the task Review pane was retired for the inline `/review` subagent) so diff and chat rendering code do not inflate the task-workspace shell chunk
- `src/components/TaskDiffView.tsx`: task diff view — changed-file list plus the lazy-loaded, line-colorized unified patch pane
- `src/components/ReviewTerminalPane.tsx`: read-only xterm.js pane that renders a reviewer's live stdout (and its last recorded output between runs); no input, session, or snapshot. Used by the single PR review's Terminal view in `PrReviewDetail` (the task workspace no longer has a Review pane — task reviews run inline via `/review`)
- `src/components/GitHubPanel.tsx`: task-inspector GitHub panel for connection state and pull request actions; composes `src/components/github/PullRequestActions.tsx` (merge with a squash/merge/rebase confirm dialog, mark-ready, close) and `src/components/github/PullRequestChecks.tsx` (the expandable per-workflow GitHub Actions / CI check drill-down with run links)
- `src/components/JiraBoardPage.tsx`: global JIRA board view — JQL config, status columns, drag-to-transition, and the **Board/Sprint view toggle**; composes `JiraBoardBody` (column grid + empty/loading states), `JiraSprintBody` (read-only sprint sections split into epic swimlanes), and `JiraCard` (draggable story card + its linked Nectus tasks; an optional `showStatus` pill for Sprint view). Sprint epic-grouping is the pure `src/lib/jiraSprints.ts` (`groupByEpic`)
- `src/components/JiraWorkItemDialog.tsx`: `JiraWorkItemPanel` — the de-modaled work-item side panel docked beside the board (transition/assign/comment + an agent-select "Create task & start" launch row). When a REST token is connected, the status dropdown shows the issue's legal transitions (fetched on open); otherwise it falls back to the board-derived options
- `src/components/JiraCreateWorkItemPanel.tsx`: `JiraCreateWorkItemPanel` — the inline "New work item" create form docked in the board's right-hand slot (project/type/summary/description/assignee/labels → `jira_create_work_item`); shares the slot with the view panel
- `src/components/JiraPanel.tsx`: task-inspector panel for the linked JIRA story (display + detach)
- `src/components/settings/`: settings subcomponents (`ProfileEditor`, `GithubConnectionCard`, `JiraConnectionCard` — the optional JIRA REST API-token connect/disconnect card, `SegmentedRadioGroup`, `SettingsOverviewItem`, `UpdateCard` — the Settings "About & Updates" card: current version, "Check for updates" button, status badge, install/relaunch actions, `DiagnosticsCard` — the Settings → Diagnostics live backend-log viewer, fed by `useDiagnostics`, with refresh/copy/clear and tail auto-follow) and profile-draft helpers
- `src/hooks/useDiagnostics.ts`: backs the Diagnostics panel — backfills the buffered backend log via `get_diagnostic_logs` on mount, then appends each live `diagnostic_log` line (via `useTauriEvent`); independent of the DB lock so it keeps updating during a hang
- `src/lib/update.ts`: Tauri-guarded updater wrapper (`isUpdaterAvailable`, `getAppVersion`, `checkForUpdate`, `installUpdate(update, onProgress)`, `relaunchApp`); no-ops outside Tauri
- `src/hooks/useAppUpdate.ts`: update state machine (`UpdateStatus = "idle"|"checking"|"upToDate"|"available"|"downloading"|"ready"|"error"`); runs one silent check shortly after launch; exposes `check`/`installUpdate`/`relaunch`, plus `info`, `currentVersion`, `progress`, `error`, `lastCheckedAt`. No-op outside Tauri
- `src/hooks/useAppUpdateToast.ts`: fires sonner launch update toasts ("Update available → Install", "Update installed → Relaunch"). Both hooks are mounted in `src/AppRouter.tsx` (`AppLayout`)
- `src/test/testUtils.tsx`: shared frontend test helpers for providers, pointer events, DOM rects, and async deferrals
- `src/test/app*Tests.tsx`: focused App test groups registered by `src/App.test.tsx`
- `src/styles.css`: **the single stylesheet and the styling source of truth** — `@import "tailwindcss"`, the `@theme inline` token→utility bridges (only meaningful lines: the `--color-*`/`--radius-*`/`--font-*`/`--tracking-*` namespaces; no self-referential no-ops), the `:root`/`.dark` OKLCH design tokens (a flat, neutral, near-black-dark "coding tool" palette with one monochrome `--primary` key — a near-white accent in dark, near-black in light, no hue — and the semantic `--status-*` hues), the `@layer base` reset, and global chrome (scrollbars, `::selection`, the `.app-shell` frame, the reduced-motion guard). **There is no per-surface CSS layer**: every component styles itself with token-consuming Tailwind utilities (`bg-card`, `text-status-warning`, `ring-border`, `data-[state=…]:`/`before:` variants) composed onto the shadcn primitives in `src/components/ui/*`; runtime-only styling (the task-card drag ghost) is set as inline styles from its hook. Do not reintroduce surface CSS files — extend components with utilities, or add a token here when a value is genuinely design-system-wide.

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
- Codex, Claude, Antigravity, and OpenCode are launched as configurable CLI commands through ACP provider descriptors.
- ACP chats are app-owned child processes.
- Closing the app stops owned ACP chats.
- The Tauri 2 auto-updater reads GitHub Releases of the public repo `github.com/hvp17/nectus` directly (no token); Apple Silicon (aarch64) only. Installed copies run one silent check shortly after launch (and on demand via Settings → About & Updates → "Check for updates"). Update integrity is secured by Tauri minisign signing, independent of Apple. The app is ad-hoc code-signed (`bundle.macOS.signingIdentity: "-"` in `native/tauri.conf.json`) but not Apple-notarized, so the first download triggers a Gatekeeper "unidentified developer" warning the user clears with right-click → Open. Ad-hoc signing matters: with no `signingIdentity` set, `tauri-action` ships a completely unsigned bundle, which a quarantined Apple Silicon download reports as the harsher "damaged and can't be opened" (no right-click bypass); ad-hoc signing downgrades that to the normal, bypassable prompt. A residual "damaged" report means the quarantine flag — `xattr -dr com.apple.quarantine "/Applications/Nectus Desktop.app"`. Notarization is **opt-in via CI secrets**: when `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are configured on the repo, `release.yml` switches the build to Developer ID signing and notarizes it (no Gatekeeper prompt); with no secrets the ad-hoc behavior above is unchanged.
- Release flow: `package.json` is the single source of truth for the app version — bump only its `version`, then merge to `main`. `native/tauri.conf.json` reads it via `"version": "../package.json"`; `native/Cargo.toml` (and its `Cargo.lock` entry) is frozen at `0.0.0` and unused for app versioning (nothing reads `CARGO_PKG_VERSION`), so never bump those. `.github/workflows/release.yml` runs on every push to `main`: a `check` job reads `package.json`'s version and only proceeds if no GitHub Release `vX.Y.Z` exists yet (so non-bump merges are no-ops); the `release` job (macos-latest/arm64, `tauri-apps/tauri-action@v0` with `GITHUB_TOKEN` + the `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets) builds aarch64, signs the updater artifacts, creates the `vX.Y.Z` tag at the merge commit, and auto-publishes a Release with the `.dmg`, `.app.tar.gz`, `.sig`, and `latest.json` (shape: `{ version, notes, pub_date, platforms: { "darwin-aarch64": { signature, url } } }`). There is no manual tagging step. Out of scope: Windows/Linux/Intel, background polling beyond the launch check.

## Notes For Future Changes

- Avoid destructive filesystem deletion for worktrees unless there is an explicit confirmation path.
- Keep GitHub integration optional, additive, and `gh`-CLI-based; do not introduce app-managed OAuth or token storage.
- JIRA is **token-only**: the connection is a user-pasted JIRA Cloud API token kept in the macOS Keychain (`native/src/jira_secret.rs`), never in SQLite, and never an OAuth flow — the **one** deliberate exception to the "no app-managed tokens" default; don't broaden token storage beyond this. Every JIRA command runs over the REST API (`jira_rest_call` in `native/src/lib.rs`); do not reintroduce a CLI dependency for JIRA.
- If adding persistent background agent work, extend the ACP chat lifecycle deliberately instead of silently detaching child processes.
- If adding more live agent UI, extend `native/src/sessions/acp_manager.rs` and the Chat pane rather than reintroducing a task PTY surface.
- When spawning any external CLI, follow [Spawning External CLIs](#spawning-external-clis-macos-gui-path): resolve the binary and set `PATH` to `process_util::augmented_path()`. A GUI-launched app's minimal PATH otherwise breaks node-based agents with `env: node: No such file or directory` (exit 127). OpenCode also has provider-specific fallback candidates under `~/.opencode/bin/opencode` and `~/bin/opencode`; Antigravity falls back to `~/.antigravity/bin/agy` (the install-script location).
- The current icon is a simple generated placeholder and can be replaced later with proper app assets.
