# Multi-Repo Workspaces — Design

- **Date:** 2026-06-06
- **Status:** Approved (implementing A, then B)
- **Topic:** Group several local git repos into a named "workspace" and, on top of
  that group, drive a single unit of work across multiple repos at once.

## Problem

Nectus is already cross-project at the *triage* level — Mission Control aggregates
tasks across every added repo. What it cannot do today:

1. **Focus a subset of repos.** With many repos added, there is no way to say "these
   three are the thing I'm working on right now" and scope the rail / Mission Control
   to that set.
2. **Work one feature across several repos.** A task is hard-bound to exactly one repo
   (`tasks.repo_id NOT NULL`, one worktree / branch / PR per task). A change that spans
   a backend repo and a frontend repo cannot be driven as a single unit of work, and an
   agent working in one repo has no context of the siblings.

## Confirmed decisions (from brainstorming)

- A **workspace = a durable, named group of repos** (VSCode-workspace style), persisted
  and reusable. A repo may belong to more than one workspace.
- Cross-repo work uses **a single agent across all the worktrees** (one session, one
  conversation), *not* one agent per repo. The agent edits across every repo in the set.
- The grouping is **hybrid**: the workspace supplies a default repo set, and an individual
  task may use a **subset** of the workspace's repos.
- Each repo in a cross-repo task still produces **its own branch and its own PR**.
- Build in **two increments**: A (grouping + filter) first, then B (cross-repo tasks).

## Architecture overview

Three new tables build on the existing flat `repos` table; per-repo worktree facts move
off the `tasks` row into a child table so a task is no longer 1:1 with a repo.

```
repos (existing, unchanged)
  └── workspace_repos (M:N) ──> workspaces           [Increment A]
tasks
  ├── workspace_id (nullable FK)                      [Increment B]
  └── task_repos (1 row per repo: branch/worktree/pr) [Increment B]
```

A **single-repo task is the N=1 case** of a cross-repo task — exactly one `task_repos`
row. This keeps one code path rather than forking "single vs multi".

---

## Increment A — Workspaces as grouping + filter

Fully additive. No change to `tasks`. Independently shippable; de-risks the concept.

### Data model (`native/src/db/schema.rs`)

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_repos (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id      INTEGER NOT NULL REFERENCES repos(id)      ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, repo_id)
);

CREATE INDEX IF NOT EXISTS workspace_repos_workspace_idx
  ON workspace_repos(workspace_id, position);
```

- Both tables are created in `create_schema`; no `run_migrations` ALTERs are needed for
  brand-new tables (`CREATE TABLE IF NOT EXISTS` covers existing DBs too).
- `position` gives stable display order within a workspace.
- `ON DELETE CASCADE` on `repos(id)`: removing a repo prunes its membership rows.

### Models (`native/src/models/`)

New `workspace.rs`, re-exported flat from `mod.rs` (matches the existing per-domain split):

```rust
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub repo_ids: Vec<i64>,   // ordered by position
    pub created_at: String,
    pub updated_at: String,
}
```

Frontend mirror in `src/types.ts`:

```ts
export interface Workspace {
  id: number;
  name: string;
  repoIds: number[];
  createdAt: string;
  updatedAt: string;
}
```

### DB layer (`native/src/db/workspaces.rs`)

New `impl Database` block (its own file by concern, like `tasks.rs`/`settings.rs`),
declared in `db/mod.rs`. Row mapping helper in `db/rows.rs` if a join row needs it.

- `list_workspaces() -> Vec<Workspace>` (each with ordered `repo_ids`)
- `create_workspace(name, repo_ids) -> Workspace`
- `update_workspace(id, name, repo_ids) -> Workspace` (replaces membership; rewrites
  `position` to the given order)
- `delete_workspace(id)`

Persistence tests go in `db/tests.rs` (the established home for DB tests): create with
repos, list returns ordered ids, update replaces membership + reorders, delete cascades
membership, deleting a member repo prunes the join row.

### Tauri commands (`native/src/lib.rs`, registered in the handler list)

- `list_workspaces() -> Result<Vec<Workspace>>`
- `create_workspace(name: String, repo_ids: Vec<i64>) -> Result<Workspace>`
- `update_workspace(id: i64, name: String, repo_ids: Vec<i64>) -> Result<Workspace>`
- `delete_workspace(id: i64) -> Result<()>`

Mirror in `src/api.ts` (typed wrappers).

### Frontend

- **State:** `useApp.ts` gains `workspaces: Workspace[]`, `activeWorkspaceId: number | undefined`,
  and `setActiveWorkspaceId`. Loaded alongside repos on mount/refresh. A new
  `workspaceRepoIds` memo resolves the active workspace's repo id set.
- **Filtering:** the existing `visibleTasks` memo and the project rail narrow to the active
  workspace's repos when one is active. `selectedRepoId` still works *within* that scope.
  "No workspace" = today's behavior (all repos), so nothing regresses.
- **Workspace management UI:** a side-panel / inline composer (no modal — matches the
  product's no-dialog convention) to create/rename/delete a workspace and check which repos
  belong. Lives near the project rail (`ProjectPanel.tsx` / `IconRail.tsx`). Uses installed
  shadcn primitives (`Button`, `Field`, `Input`, `Switch`/checkbox list, `Separator`).
- **Workspace switcher:** a compact control on the rail or above the project list to pick
  the active workspace (or "All repos"). Mission Control's cross-project view respects it.
- **Browser seed:** `src/lib/browserSeed.ts` seeds a sample workspace so the surface is
  previewable in `pnpm dev`.

### Tests (Increment A)

- Rust: `db/tests.rs` persistence cases above; `cargo test` green.
- Frontend: a focused group under `src/test/app*Tests.tsx` (registered by `App.test.tsx`)
  covering: switching the active workspace filters the rail + visible tasks; "All repos"
  restores the full set; create/rename/delete round-trips through the api wrapper (mocked).

### Docs (Increment A)

- `docs/features.md`: new "Workspaces" subsection (what a workspace is, how the filter
  scopes the rail + Mission Control, the hybrid default).
- `docs/tracking-and-debugging.md`: the `workspaces` / `workspace_repos` tables and the
  four new commands.
- `README.md`: one-line mention in the feature list if appropriate.
- `CLAUDE.md`: add the new commands to the exposed-command list and the new files to the
  backend/frontend boundary maps.

---

## Increment B — Cross-repo tasks (single agent across worktrees)

Built on A. The deep change: a task spans 1..N repos with one session.

### Data model

```sql
ALTER TABLE tasks ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id);

CREATE TABLE IF NOT EXISTS task_repos (
  task_id       INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  repo_id       INTEGER NOT NULL REFERENCES repos(id)  ON DELETE CASCADE,
  branch_name   TEXT,
  worktree_path TEXT,
  pr_url        TEXT,
  position      INTEGER NOT NULL,
  PRIMARY KEY (task_id, repo_id)
);
```

- `task_repos` becomes the **source of truth** for per-repo worktree/branch/PR state.
- **Migration:** for every existing task, insert one `task_repos` row from its current
  `repo_id`/`branch_name`/`worktree_path`/`pr_url`, then retire those task columns
  (kept-but-ignored vs dropped is a plan-time call; SQLite drop-column is supported on
  modern versions, otherwise leave nullable + unused). `tasks.repo_id` is retained as a
  denormalized **primary repo** for sort/display and the single-repo fast path.
- Re-home the existing uniqueness guarantees (`tasks_worktree_path_unique`,
  `tasks_repo_branch_unique`) onto `task_repos`.

### Worktree layout & session

- All worktrees for one task live as siblings under a shared parent:
  `~/.nectus/workspaces/<workspace>/<task-branch>/<repoName>/`. Each `<repoName>` is a
  git worktree of that repo on the task's branch. Pattern stays configurable; extends the
  existing `~/.nectus/worktrees/{repoName}` convention.
- The agent **session cwd is the parent folder**, so every repo is a sibling directory the
  single agent can read and edit. The task keeps its single `agent_profile_id` /
  `active_session_id`. Worktree create/remove fans out over the task's repos using the
  existing `git_ops` worktree lifecycle, with guaranteed teardown.
- Follows the macOS GUI-PATH rule already documented (resolve binary + `augmented_path()`).

### Diffs, PRs, UI

- `task_diff_summary` / `task_diff_file` extend to be per-repo (diff grouped by repo;
  `resolve_diff_base` already runs per repo). `TaskDiffView.tsx` groups the changed-file
  list by repo.
- GitHub panel shows **one PR row per repo** (create/detect/status per `task_repos` row)
  instead of a single `pr_url`.
- Task creation in a workspace defaults to all its repos with checkboxes to subset (hybrid).
- Mission Control / board render a cross-repo task as one card annotated with its repo set.

### Out of scope for B (YAGNI)

- One-agent-per-repo topology (explicitly rejected during brainstorming).
- Cross-repo atomic operations (coordinated single PR across repos, cross-repo merge gates).
- Workspace-scoped settings beyond the repo membership itself.

---

## Verification gates (every increment)

```
pnpm test
pnpm build
cd native && cargo test
```

`cargo fmt` is **not** run blindly — it rewrites committed vendored files; if used, revert
unrelated churn (see project memory). Docs updated in the same change as behavior.
