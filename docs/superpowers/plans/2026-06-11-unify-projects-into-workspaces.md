# Unify Projects into Workspaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove "project" as a user-facing container. One navigator section, one board view, one composer scope, one collapse mechanism — all keyed on **workspaces (1+ folders)**. Repos stay as internal, identity-bearing entities; no change to the `repos`/`tasks`/`task_repos` schema or any git/session/PR behavior.

**Architecture:** Backend gets two invariants (every folder ∈ ≥1 workspace; empty workspaces are deleted) enforced by an idempotent repair helper run on DB open and after workspace delete/update and `remove_repo`; `add_repo` gains an optional target workspace and auto-creates a single-folder workspace otherwise. Frontend drops the `selectedRepoId` selection, the `"workspace"` view value, the Projects sidebar section, the Project composer mode, and the repo collapse path; a pure `workspaceForRepo` helper replaces every "repo id as destination" site.

**Tech Stack:** Rust + rusqlite (`native/src/db/`), Tauri commands (`native/src/lib.rs`), React + TypeScript + Zustand + TanStack Query, Vitest, shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-06-11-unify-projects-into-workspaces-design.md`

---

## File Structure

**Create:**
- `src/lib/workspaceScope.ts` — pure helper: `workspaceForRepo(workspaces, repoId, preferredId?)` (prefer the focused workspace when it contains the repo, else the first containing one, ordered as listed).
- `src/lib/workspaceScope.test.ts` — unit tests.

**Modify (backend):**
- `native/src/db/workspaces.rs` — `ensure_repo_workspace_membership` repair helper + deduped auto-naming; orphan repair in `delete_workspace`/`update_workspace`.
- `native/src/db/mod.rs` — `insert_repo` gains workspace handling via a new `add_repo_with_workspace`; `remove_repo` deletes now-empty workspaces; drop `set_repo_collapsed`.
- `native/src/db/schema.rs` — call the repair helper from `run_migrations`; comment `repos.collapsed` as vestigial.
- `native/src/db/rows.rs` — drop `collapsed` from the repo row mapping.
- `native/src/db/tests.rs` — new invariant/migration tests; update repo-collapse tests.
- `native/src/models/workspace.rs` (or a small addition near `Repo`) — `AddRepoResult { repo, workspace }`.
- `native/src/lib.rs` — `add_repo(path, workspace_id: Option<i64>) -> AddRepoResult`; remove the `set_repo_collapsed` command + registration.

**Modify (frontend):**
- `src/types.ts`, `src/api.ts` — `addRepo` returns `{ repo, workspace }` and takes an optional `workspaceId`; remove `setRepoCollapsed`; drop `Repo.collapsed`.
- `src/store/slices/selectionSlice.ts` — remove `selectedRepoId`.
- `src/store/slices/navigationSlice.ts` — drop the `"workspace"` view value; `"board"` is the (only) workspace board, driven by `activeWorkspaceId`.
- `src/store/slices/composerSlice.ts` — `newTaskWorkspaceId` becomes the required scope; drop the scalar `newTaskRepoId`.
- `src/taskNavigation.ts` — `planTaskFocus` resolves a workspace id, not a repo id.
- `src/AppRouter.tsx` — delete `BoardView`, keep one board view; single-path `openComposer`; rework `handleNavigate`/palette/task-focus wiring.
- `src/components/ProjectPanel.tsx` → renamed `src/components/WorkspacePanel.tsx` — single Workspaces section.
- `src/components/ProjectRowMenu.tsx` → reworked as the workspace row menu (rename / edit folders / delete).
- `src/components/WorkspaceManager.tsx` — "Add folder…" (with target workspace) and "Remove folder from Nectus" affordances; delete copy explains ungrouping.
- `src/components/CreateTaskComposer.tsx` — always workspace-scoped; single-folder layout keeps the direct-edit/worktree toggle.
- `src/hooks/useComposer.ts` — one submit path branching on member count.
- `src/hooks/useProjectActions.ts` → renamed `src/hooks/useFolderActions.ts` (`addFolder(workspaceId?)`, `renameFolder`, `removeFolder`).
- `src/hooks/useSidebarCollapse.ts` — workspace-only.
- `src/hooks/useShellBootstrap.ts` — default-focus the first workspace.
- `src/lib/sidebarAgents.ts` — `byWorkspace` only (`byRepo` becomes an internal intermediate).
- `src/components/CommandPalette.tsx` — drop the Projects group.
- `src/components/Workspace.tsx` — drop the `selectedRepo` header variant; repo badges only for multi-folder workspaces.
- `src/lib/browserSeed.ts` — every seeded repo gets a (single- or multi-folder) workspace.
- `src/test/appSidebarTests.tsx`, `src/test/appWorkspacesTests.tsx`, other `src/test/app*Tests.tsx` touched by selection changes.
- Docs: `docs/features.md`, `docs/tracking-and-debugging.md`, `AGENTS.md` (file maps), `README.md`.

**Delete:**
- `src/components/ProjectRowMenu.tsx` (superseded by the workspace row menu)
- The `set_repo_collapsed` command and its frontend path.

---

## Task 1: Backend invariants — repair helper, auto-workspace, deduped naming

**Files:** `native/src/db/workspaces.rs`, `native/src/db/schema.rs`, `native/src/db/tests.rs`

- [ ] **Step 1: Write failing tests** in `native/src/db/tests.rs`:
  - `every_repo_gets_a_workspace_on_migration` — insert two repos and one workspace containing only the first; run `ensure_repo_workspace_membership`; the second repo now has a single-folder workspace named after it; rerunning changes nothing (idempotent).
  - `auto_workspace_name_dedupes` — with a workspace already named `nectus`, repairing an orphan repo named `nectus` creates `nectus 2` (case-insensitive collision).
  - `delete_workspace_repairs_orphans` — delete a workspace whose member is in no other workspace → the member gets an auto workspace; a member also in another workspace gets nothing.
  - `update_workspace_repairs_dropped_members` — same via membership shrink.
- [ ] **Step 2: Implement** in `workspaces.rs`:

```rust
/// Invariant 1: every repo belongs to at least one workspace. Creates a
/// single-folder workspace named after each orphaned repo (numeric-suffix
/// deduped against the case-insensitive unique-name rule). Idempotent; run
/// on open and after any operation that can orphan a repo.
pub fn ensure_repo_workspace_membership(&self) -> Result<(), String>
fn unique_workspace_name(&self, base: &str) -> Result<String, String>
```

  `delete_workspace` and `update_workspace` call the repair helper after their write (inside the same lock scope, after the transaction commits — it only does DB work, no subprocesses).
- [ ] **Step 3:** Call `ensure_repo_workspace_membership` at the end of `run_migrations` in `schema.rs` (after `backfill_task_repos`), with a comment marking it the projects→workspaces unification migration.
- [ ] **Step 4:** `cd native && cargo test db::` — green; `cargo fmt --check && cargo clippy --all-targets -- -D warnings`.

## Task 2: Backend commands — `add_repo` with workspace, `remove_repo` cleanup, drop repo collapse

**Files:** `native/src/db/mod.rs`, `native/src/db/rows.rs`, `native/src/models/`, `native/src/lib.rs`, `native/src/db/tests.rs`

- [ ] **Step 1: Failing tests:** `add_repo_creates_single_folder_workspace`, `add_repo_into_existing_workspace_appends_membership`, `remove_repo_deletes_emptied_workspaces` (a 2-folder workspace survives losing one member; a 1-folder workspace is deleted with its repo).
- [ ] **Step 2:** New DB method `add_repo_with_workspace(&self, repo_path: &Path, workspace_id: Option<i64>) -> Result<AddRepoResult, String>` wrapping `insert_repo` + membership/auto-workspace in one transaction. `AddRepoResult { repo: Repo, workspace: Workspace }` (serde camelCase, exported from `models/mod.rs`).
- [ ] **Step 3:** `remove_repo` additionally deletes workspaces left with zero members (invariant 2). Keep its tasks-exist refusal and disk-untouched guarantees verbatim.
- [ ] **Step 4:** In `lib.rs`: `add_repo(path: String, workspace_id: Option<i64>, …) -> AppResult<AddRepoResult>` (still `blocking`, git validation off-lock as today). Delete the `set_repo_collapsed` command and its `generate_handler!` entry. Drop `collapsed` from the repo SELECTs/`rows.rs` mapping and the `Repo` model; leave the SQLite column in place (additive-only migrations) with a "vestigial" comment in `schema.rs`.
- [ ] **Step 5:** `cargo test` + fmt + clippy green.

## Task 3: Frontend scope helper + task-focus rework

**Files:** `src/lib/workspaceScope.ts` (+test), `src/taskNavigation.ts` (+ its tests)

- [ ] **Step 1: Failing unit tests:** `workspaceForRepo` prefers `preferredId` when it contains the repo; else first containing workspace in list order; `undefined` for an unknown repo. `planTaskFocus` returns `{ workspaceId, view, dismissComposer }` — secondary views route to `"board"`; the focused workspace is kept when it contains the task's repo (no board jump when opening a task already on the current board).
- [ ] **Step 2: Implement.** `planTaskFocus(view, task, composerOpen, workspaces, activeWorkspaceId)` delegates to `workspaceForRepo(workspaces, task.repoId, activeWorkspaceId)`.
- [ ] **Step 3:** `pnpm test -- workspaceScope taskNavigation` green.

## Task 4: Store merge — selection, navigation, composer slices

**Files:** `src/store/slices/{selectionSlice,navigationSlice,composerSlice}.ts`, `src/store/appStore.test.ts`, `src/types.ts`, `src/api.ts`

- [ ] **Step 1:** Remove `selectedRepoId` from `selectionSlice`. `navigationSlice`: `AppView` loses `"workspace"`; `openWorkspaceBoard(id)` sets `{ activeWorkspaceId: id, selectedTaskId: undefined, currentView: "board" }`. `composerSlice`: drop `newTaskRepoId`; `newTaskWorkspaceId` is the scope (always set on open), `newTaskRepoIds` the member picks (a single-folder workspace pre-fills its sole member).
- [ ] **Step 2:** `api.ts`: `addRepo(path, workspaceId?)` typed to `AddRepoResult`; remove `setRepoCollapsed`. `types.ts`: drop `Repo.collapsed`, add `AddRepoResult`.
- [ ] **Step 3:** Fix compile fallout in hooks that read the removed fields (`useComposer`, `useShellBootstrap`, `useSessionControls` if it touches selection) — mechanical only; behavior changes land in Tasks 5–7. `pnpm test -- appStore` green.

## Task 5: Shell — one board view, one navigator section

**Files:** `src/AppRouter.tsx`, `src/components/WorkspacePanel.tsx` (renamed from `ProjectPanel.tsx`), `src/components/ProjectRowMenu.tsx` → workspace row menu, `src/lib/sidebarAgents.ts` (+test), `src/components/Workspace.tsx`, `src/components/CommandPalette.tsx`, `src/hooks/useSidebarCollapse.ts`, `src/hooks/useShellBootstrap.ts`, `src/hooks/useFolderActions.ts` (renamed from `useProjectActions.ts`), `src/test/appSidebarTests.tsx`

- [ ] **Step 1: Rework App tests** (`appSidebarTests.tsx`): the panel renders one "Workspaces" section; a single-folder workspace row shows the folder icon and opens the board; the row menu renames/deletes a workspace; deleting a multi-folder workspace keeps its folders reachable (auto workspaces appear after refetch — assert via the mocked command layer); "Add folder" calls `add_repo` and focuses the returned workspace.
- [ ] **Step 2: `AppRouter.tsx`:** delete `BoardView` + `useBoardArchiveToggle`'s project branch; the single board view is today's `WorkspaceView` at `currentView === "board"`. `handleNavigate("board")` falls back to the first workspace when none is focused. `openTask` uses the new `planTaskFocus` (sets `activeWorkspaceId`). Palette handlers: drop `openProjectBoard`. `TaskWorkspaceOverlay`'s `backLabel` = focused workspace name or "Mission Control"; keep `repoName` (per-task badge) as is.
- [ ] **Step 3: `WorkspacePanel.tsx`:** one section listing workspaces; `NavRow` keeps the nested-agent fold (workspace collapse only) and the per-row "+" (composer with `workspaceId` target); the ⓘ folder popover renders for multi-folder workspaces; the row menu offers Rename, Edit folders… (opens the manager focused on it), Delete. Section header actions: "Add folder" (auto-workspace) and "New workspace" (manager).
- [ ] **Step 4:** `sidebarAgents.ts`: export `buildSidebarAgents` returning `byWorkspace` only (keep the repo bucketing as a local intermediate). `Workspace.tsx`: remove the `selectedRepo` header variant; pass `repoNames` (card badges) only when the focused workspace has ≥2 members. `CommandPalette.tsx`: remove the Projects group. `useSidebarCollapse.ts`: workspace-only. `useShellBootstrap.ts`: default-focus the first workspace instead of the first repo; keep the drop-deleted-workspace effect. `useFolderActions.ts`: `addFolder(workspaceId?)` focuses `result.workspace`; `removeFolder` clears focus if its workspace vanished.
- [ ] **Step 5:** `pnpm test` green for the sidebar/workspace groups.

## Task 6: Composer — one workspace-scoped path

**Files:** `src/hooks/useComposer.ts`, `src/components/CreateTaskComposer.tsx`, `src/AppRouter.tsx` (`openComposer`), `src/test/app*Tests.tsx` (composer groups)

- [ ] **Step 1: Rework tests:** opening from a single-folder workspace shows the worktree toggle and no checklist; submit with worktree off → `create_task` with `hasWorktree: false`; a ≥2-folder workspace shows the checklist; 1 pick → `create_task` worktree task, ≥2 picks → `create_cross_repo_task`; "create from JIRA story" lands in the focused (or repo-resolved) workspace.
- [ ] **Step 2: `openComposer`:** one path — resolve the target workspace (explicit target → focused workspace → first workspace), set `newTaskWorkspaceId` + pre-fill `newTaskRepoIds` with its known members (single member auto-picked).
- [ ] **Step 3: `useComposer.createTask`:** single submit path: `repoIds = newTaskRepoIds`; `repoIds.length >= 2` → cross-repo (always worktree, unchanged); `=== 1` → `create_task` honoring `newTaskHasWorktree` (restoring the direct-edit option that Project mode had and workspace mode lacked). `finishCreate` focuses the scope workspace instead of `setSelectedRepoId`. `createTaskFromStory` resolves its workspace via `workspaceForRepo` and routes to `"board"`.
- [ ] **Step 4: `CreateTaskComposer.tsx`:** scope header shows the workspace name with a switcher across all workspaces (today's cross-repo switcher, now always present); checklist section renders only for ≥2 known members; worktree toggle renders only for a single pick. Keep all `data-testid`s used by tests, renaming only where the interaction model changed.
- [ ] **Step 5:** `pnpm test` composer groups green.

## Task 7: Manager, seeds, and the long tail

**Files:** `src/components/WorkspaceManager.tsx`, `src/lib/browserSeed.ts`, `src/test/appWorkspacesTests.tsx`, any remaining `selectedRepoId` references

- [ ] **Step 1: `WorkspaceManager.tsx`:** per-workspace folder checklist gains "Add folder…" (`addFolder(workspaceId)`); a folder row gains "Remove from Nectus" (the `remove_repo` confirm flow, copy: refused while tasks exist, disk untouched); delete copy: "Deletes the grouping — folders and their tasks are kept (each folder stays reachable in its own workspace)."
- [ ] **Step 2: `browserSeed.ts`:** give every seeded repo a workspace (keep the existing multi-folder one; add single-folder workspaces for the rest) so the browser preview renders the unified navigator.
- [ ] **Step 3:** `rg "selectedRepoId|setRepoCollapsed|newTaskRepoId\b|useProjectActions|ProjectPanel|onOpenProject"` — zero hits outside tests/docs being updated.
- [ ] **Step 4:** Full `pnpm verify` + `cd native && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.

## Task 8: Documentation sweep

**Files:** `docs/features.md`, `docs/tracking-and-debugging.md`, `AGENTS.md`, `README.md`

- [ ] `docs/tracking-and-debugging.md`: command reference — `add_repo` signature/result, removed `set_repo_collapsed`, new `delete_workspace`/`update_workspace` orphan-repair semantics, the migration; note `repos.collapsed` as vestigial.
- [ ] `docs/features.md`: navigator (one Workspaces section), board, composer scope, folder add/remove flows, workspace delete semantics.
- [ ] `AGENTS.md` file maps: `WorkspacePanel.tsx`, `useFolderActions.ts`, the slimmed slices/hooks; update the Product Defaults bullet ("Projects are existing local git repos" → folders inside workspaces).
- [ ] `README.md`: high-level workflow wording if it mentions projects-vs-workspaces.

---

## Verification

```bash
pnpm verify
cd native && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

Manual (in `pnpm desktop:dev`): migrate an existing DB (repos without workspaces appear as single-folder workspaces); add a folder (auto-workspace, board focuses); create single-folder direct-edit + worktree tasks and a cross-repo task; delete a multi-folder workspace and confirm its folders' boards/tasks survive; remove a folder (refused with tasks, then succeeds after deletion and its empty workspace disappears).
