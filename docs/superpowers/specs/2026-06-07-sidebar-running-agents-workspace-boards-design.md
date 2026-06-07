# Sidebar Running Agents + Workspace Boards — Design

- **Date:** 2026-06-07
- **Status:** Approved (pending spec review)
- **Topic:** Move the running-agents list out of its rail popup and into a
  persistent sidebar that navigates by **project** and **workspace**, and make a
  selected workspace open a new aggregated kanban across its repos.

## Problem

Two rough edges in today's shell:

1. **Running agents hide in a popup.** `RunningAgentsFlyout` is a rail-anchored
   Popover grouped by state. It is global but transient — you open it, glance,
   and it closes. There is no always-visible at-a-glance list of in-flight agents.
2. **Workspaces can only filter, not be a destination.** A workspace is a repo
   scope filter (`activeWorkspaceId`) applied to Mission Control and the project
   rail. You cannot open "the Core workspace" as its own board; you can only open
   one repo's board at a time.

## Confirmed decisions (from brainstorming)

- The running-agents list moves **inline into a persistent sidebar panel**, no popup.
- That panel **merges the project rail (`ProjectPanel`) and the running-agents
  flyout** into one component with two sections: **PROJECTS** and **WORKSPACES**.
- **Both** projects and workspaces are listed and navigable. Clicking a project
  opens its single-repo board; clicking a workspace opens its **workspace board**.
- A **workspace board is a new aggregated kanban** across all the workspace's
  repos with shared status columns (not Mission Control re-scoped). Each card
  shows a repo badge.
- Active agents (`needs_you` / `running` / `review`) **nest under each project
  and each workspace** row. An agent legitimately appears under both its project
  and any workspace containing it — two lenses on the same agents, by design.
- Each workspace row carries an **info card (ⓘ popover)** listing its projects;
  the workspace group itself does **not** expand into project sub-rows.
- **Panel visibility:** persistent on **Mission Control + project Board +
  Workspace board**; hidden on Settings / JIRA / Reviews and when a task or the
  composer/workspace-manager is open (decision *a*).
- **Retire the workspace scope-switcher** (decision *b*). With workspaces now
  navigable to their own boards, the `All repos | … | Manage` filter is removed
  from the Mission Control header; Mission Control always shows every project.

## Architecture overview

**Frontend-only.** No Rust, schema, or Tauri-command changes. Every input already
exists: `tasks` carry `repoId`, `workspaces` carry ordered `repoIds`, and
`buildAgentRows` already derives per-task state. The work is composition + routing
+ styling in `src/`.

```
IconRail  (loses the "Running agents" button)
SidebarPanel  (reworked ProjectPanel — merges project rail + running agents)
  ├── PROJECTS   → project board   (existing Workspace.tsx kanban)
  └── WORKSPACES → workspace board  (new aggregated kanban)
WorkspaceBoard  (Workspace.tsx, fed multi-repo tasks + repo badge on cards)
```

## 1. The merged sidebar panel (`src/components/ProjectPanel.tsx`, reworked)

Replaces both `ProjectPanel` and `RunningAgentsFlyout`. The rail's running-agents
button and the `RunningAgentsFlyout` component are deleted.

Structure (single scroll region):

```
Nectus                       Manage
─────────────────────────────────
PROJECTS                        +
  nectus-desktop          2 ●  ▾     ← name → project board
    ✷ Running agents sidebar  now    ← active agents nested
    ✷ Fix diff colors          3m
  polyarchive-explore       0
  polymarket-trader       1 ●  ▾
    ✷ Quick add task          1h
─────────────────────────────────
WORKSPACES
  Core           ⓘ        3 ●  ▾     ← name → workspace board
    ✷ … agents across Core repos
  Trading        ⓘ        1 ●
```

- **Projects section.** Every repo (no workspace scoping). Each row: folder icon,
  name, and an active-agent **count + state dot** (warning if any nested agent is
  `needs_you`, else primary if any `running`, else info; nothing/`0` when idle).
  Active agents nest beneath as compact rows. Header keeps the `+` add-project
  action. Row click → `onSelectRepo(repoId)` (project board); agent click →
  `onOpenTask(taskId)`.
- **Workspaces section.** Every workspace. Each row: name, **ⓘ info card**, and the
  same count + dot computed over the workspace's repos. Active agents nest beneath.
  Row click → `onSelectWorkspace(workspaceId)` (workspace board). The **ⓘ** opens a
  `popover` (`src/components/ui/popover.tsx`) listing the workspace's project names
  (each clickable to open that project's board — cheap reuse of `onSelectRepo`).
- **Agent rows.** Reuse the flyout's compact vocabulary (agent logo, branch, title,
  latest line, elapsed, live dot) extracted into a shared `SidebarAgentRow` so the
  deleted flyout's row markup is preserved, not duplicated.
- **Grouping helper.** A small pure helper builds the active-agent rows
  (`buildAgentRows` filtered to `ACTIVE_AGENT_STATES`) and buckets them
  `byRepoId` and `byWorkspaceId` (workspace bucket = union of its `repoIds`). Lives
  beside `agentState.ts` so Mission Control's logic is untouched.
- **Elapsed ticking.** The panel is always mounted, so it owns a 60s interval (like
  Mission Control) to keep elapsed labels advancing.

## 2. Workspace board (new view)

Reuses `Workspace.tsx`'s kanban wholesale — the four status columns
(Planned → In Progress → Review → Done), drag-to-restage, `TaskCard`, skeleton, and
empty state all stay. Differences:

- **Tasks fed in** = all tasks whose `repoId ∈ workspace.repoIds` (a new
  `workspaceBoardTasks` memo in `useApp`).
- **`TaskCard` gains an optional repo-name badge** (`repoName?: string`), rendered
  only when present, so the single-repo board is visually unchanged and the
  workspace board disambiguates cards across repos.
- **Header** shows the workspace name and project count instead of a single repo
  name; "New Task" in this header opens the composer in workspace context (§3).
- Drag-to-restage works unchanged — status is a per-task field independent of repo.

## 3. State & routing (`src/hooks/useApp.ts`, `src/App.tsx`)

- **New route.** `currentView` adds `"workspace"`. `App` renders the workspace board
  for that view. `IconRail`'s `railActive` maps `"workspace"` → no rail highlight
  (the workspace board is panel-driven, not a rail destination); the `RailView`
  type and rail nav are otherwise unchanged.
- **`activeWorkspaceId` is repurposed from "scope filter" to "focused workspace".**
  It is set when a workspace board is opened and cleared when navigating to Mission
  Control, a project board, or a secondary view. Consequences:
  - **Scope-filter usages are removed:** `scopedRepos` collapses to all `repos`;
    `missionTasks` collapses to all `tasks`; `visibleTasks` drops the workspace
    narrowing (keeps the `selectedRepoId` filter); the "keep selected repo inside
    the active workspace" effect is deleted.
  - **Cross-repo task creation is preserved.** `activeWorkspaceRepos` now resolves
    to the focused workspace's repos, so opening the composer from a workspace board
    still offers the repo multi-select and routes through `create_cross_repo_task`
    (`activeWorkspaceRepos.length >= 2 && newTaskRepoIds.length >= 1`), exactly as
    today. From Mission Control / a project board, `activeWorkspaceId` is undefined
    → single-repo create, unchanged.
- **Panel visibility / frame.** `data-frame="railp"` (rail + panel + viewport) when
  `currentView ∈ {mission, board, workspace}` and no task / composer / workspace
  manager is open; otherwise `"rail"`. Mission Control becomes a 3-column layout;
  Settings / JIRA / Reviews stay 2-column.
- **Opening a task** from the panel works on every panel view. `planTaskFocus`
  handles a `"workspace"` origin (task opens over the workspace board; closing
  returns to it), and `taskOpen` includes `currentView === "workspace"`.

## 4. Removed / retired

- `src/components/RunningAgentsFlyout.tsx` — deleted; content lives in the panel.
- `IconRail`'s `runningAgentsSlot` prop and the running-agents button.
- `src/components/WorkspaceSwitcher.tsx` and its use in the Mission Control header
  and the panel — the workspace scope filter is gone. (`WorkspaceManager` and the
  `Manage` entry point stay; the panel header keeps a `Manage` button.)

## 5. Styling (`src/styles/redesign.css`)

- New `nx-` classes for the panel's section kickers, nav rows with count/dot,
  nested agent rows (can extend the existing `nx-fly-row*` rules rather than
  reinvent), and the ⓘ info-card list. The persistent panel reuses the existing
  `.nx-panel` column slot and `--nx-rail-w`-style sizing.
- `TaskCard` repo badge: a compact `Badge`/`nx-` chip, theme tokens only (no new
  colors), shown only on the workspace board.

## 6. Tests

- **Frontend** (`src/test/app*Tests.tsx`, registered by `App.test.tsx`):
  - panel renders both PROJECTS and WORKSPACES with correct active-agent counts and
    state dots; idle projects show no agents.
  - clicking a project opens its board; clicking a workspace opens the workspace
    board showing tasks from all its repos; cards carry repo badges.
  - the ⓘ info card lists the workspace's projects.
  - the panel is present on Mission Control + boards and absent on Settings / JIRA /
    Reviews and when a task is open.
  - retired switcher: Mission Control no longer renders the workspace filter and
    shows all projects.
  - cross-repo create still routes correctly from a workspace board (mocked api).
  - update/remove tests that referenced `RunningAgentsFlyout` / `WorkspaceSwitcher`.
- **Browser seed** (`src/lib/browserSeed.ts`): already seeds workspaces + agents;
  confirm the panel and a workspace board are previewable in `pnpm dev`.

## 7. Docs

- `docs/features.md`: rewrite the sidebar / running-agents / workspaces sections —
  the persistent panel, project vs workspace navigation, workspace boards, and the
  retired scope switcher.
- `CLAUDE.md`: update the frontend boundary map (`ProjectPanel` reworked; remove
  `RunningAgentsFlyout` and `WorkspaceSwitcher`; note the workspace board and the
  `currentView = "workspace"` route).
- `docs/tracking-and-debugging.md`: only if event/state behavior changes (it does
  not — note "no change" and skip if so).

## Out of scope (YAGNI)

- Collapsing / persisting per-row expand state (agents always shown inline).
- Reordering projects/workspaces in the panel.
- A workspace-board-specific cross-repo "single PR" flow (covered by the existing
  cross-repo task design, unchanged here).

## Verification gates

```
pnpm test
pnpm build
cd native && cargo test
```

`cargo test` is expected to be a no-op pass (no Rust changes) but is run to confirm.
`cargo fmt` is **not** run blindly — it rewrites committed vendored files; revert any
unrelated churn if used (project memory). Docs updated in the same change as behavior.
