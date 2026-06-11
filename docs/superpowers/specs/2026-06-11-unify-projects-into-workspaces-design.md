# Unify Projects into Workspaces — Design

- **Date:** 2026-06-11
- **Status:** Proposed
- **Topic:** Remove "project" as a user-facing container. The navigator, boards,
  composer, and palette deal only in **workspaces (1+ folders)**; a repo becomes a
  *folder inside a workspace*, never a destination of its own.

## Problem

A project today is, in the user's mental model, "a workspace with one folder" —
and the code almost literally agrees:

- The workspace board is **pure aggregation**: the same `Workspace.tsx` kanban as
  the project board, filtered by `workspace.repoIds.includes(task.repoId)` instead
  of `task.repoId === selectedRepoId` (`src/AppRouter.tsx`, `BoardView` vs
  `WorkspaceView`).
- Backend-side, a workspace is only `(name, collapsed)` plus `workspace_repos`
  membership; beyond CRUD it is only stamped onto cross-repo tasks at creation.

Keeping both nouns costs real duplication: two sidebar sections in
`ProjectPanel.tsx`, two selection slices (`selectedRepoId` / `activeWorkspaceId`),
two views (`board` / `workspace`), two collapse commands (`set_repo_collapsed` /
`set_workspace_collapsed`), two composer modes in `useComposer.ts`, parallel CRUD
hooks (`useProjectActions` / `useWorkspaceActions`), and a "Projects" + a
"Workspaces" group in the command palette.

## Decision

**Workspaces become the only user-facing container.** Repos stay as an internal
entity — they are identity-bearing (git path, worktree root `{repoName}` pattern,
session cwd, GitHub PR↔repo resolution, branch lifecycle) and cannot be merged
away. Nothing about the `repos`/`tasks`/`task_repos` schema or the git/session/PR
backend changes. This is a navigation-and-container unification, not a data-model
rewrite.

UI vocabulary: a workspace contains **folders** (each folder is a local git repo).

## Invariants

1. **Every folder belongs to ≥1 workspace.** Enforced by an idempotent repair
   helper run as a migration on DB open and after any operation that could orphan
   a folder (workspace delete, membership update).
2. **Every workspace has ≥1 folder.** Already enforced by
   `create_workspace`/`update_workspace`; additionally, a workspace whose last
   folder is removed from Nectus is deleted.

## Confirmed semantics

- **Adding a folder** (`add_repo`) optionally targets a workspace. With no target
  it auto-creates a single-folder workspace named after the repo (name deduped
  with a numeric suffix against the case-insensitive unique-name rule). One DB
  transaction; the command returns `{ repo, workspace }` so the UI can focus the
  new board immediately.
- **Deleting a workspace ungroups; it never loses folders.** Any member folder
  that would end up in zero workspaces gets its auto single-folder workspace
  recreated by the repair helper. Tasks are untouched (they hang off repos, not
  workspaces — `tasks.workspace_id` tolerates dangling ids by design).
- **Removing a folder from Nectus** stays the existing `remove_repo` flow:
  refused while tasks reference it, never touches disk. Afterwards, memberships
  cascade away and now-empty workspaces are deleted (invariant 2).
- **Renames are two distinct, both-kept actions:** workspace rename
  (`update_workspace`) names the board; folder rename (`rename_repo`) names the
  chip/badge. Renaming one never renames the other.
- **The composer is always workspace-scoped.** A workspace with ≥2 known folders
  shows the cross-repo checklist (≥2 picks → `create_cross_repo_task`, 1 pick →
  single-repo worktree task — exactly today's workspace mode). A single-folder
  workspace renders today's Project mode form, **keeping the direct-edit vs
  worktree toggle** (cross-repo tasks remain always-worktree).
- **One board view.** `currentView` keeps the value `"board"`, now driven by
  `activeWorkspaceId`. `selectedRepoId` disappears from the store; everywhere a
  repo id used to pick a destination (task focus, palette, JIRA launch, post-create
  selection) a pure helper resolves *a workspace containing that repo*, preferring
  the currently focused one.
- **One collapse mechanism.** `set_repo_collapsed` and `Repo.collapsed` go away;
  `repos.collapsed` stays as a vestigial SQLite column (additive-only migrations;
  documented as unused).

## Out of scope (unchanged)

- The `repos`, `tasks`, `task_repos` schema; `create_task` /
  `create_cross_repo_task`; all git/worktree/session/GitHub/JIRA backend behavior.
- Increment B (per-repo diffs and PRs, the live spec
  `2026-06-06-multi-repo-workspaces-design.md`) — fully compatible; this change
  only collapses the container UX above it.
- Zero-folder workspaces (rejected: no board, no tasks, empty-state handling
  everywhere for no workflow gain).
- Renaming the "workspace" term itself.

## Rejected alternative

*Eliminate the `repos` table and key everything on workspaces.* Rejected: repo
identity is load-bearing in nearly every backend operation (worktree planning,
session cwd, PR resolution all flow through `repo_id`, and cross-repo tasks keep a
primary repo for the session cwd). Merging the tables would be a high-risk rewrite
for zero user-visible gain over the container unification above.
