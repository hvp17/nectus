# Sidebar Running Agents + Workspace Boards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rail's running-agents popup with a persistent sidebar that lists projects and workspaces, nests each one's active agents inline, and opens a new aggregated kanban when a workspace is selected.

**Architecture:** Frontend-only (`src/`). No Rust / schema / Tauri-command changes — every input already exists (`tasks.repoId`, `workspaces.repoIds`, `buildAgentRows`). We add a pure grouping helper, extract a shared agent-row component, rework `ProjectPanel` into the merged navigator, add a `currentView = "workspace"` route reusing `Workspace.tsx`'s kanban, repurpose `activeWorkspaceId` from "scope filter" to "focused workspace", and delete `RunningAgentsFlyout` + `WorkspaceSwitcher`.

**Tech Stack:** React + TypeScript + Vite, Vitest + @testing-library/react, shadcn primitives (`popover`), `nx-` CSS in `src/styles/redesign.css`.

**Spec:** `docs/superpowers/specs/2026-06-07-sidebar-running-agents-workspace-boards-design.md`

---

## File Structure

**Create:**
- `src/lib/sidebarAgents.ts` — pure helper: active agents bucketed `byRepo` / `byWorkspace`, plus `dominantState`.
- `src/lib/sidebarAgents.test.ts` — unit tests for the helper.
- `src/components/SidebarAgentRow.tsx` — the compact agent row, extracted from the deleted flyout's `FlyRow`.
- `src/test/appSidebarTests.tsx` — App-level tests for the merged panel + workspace board.

**Modify:**
- `src/components/ProjectPanel.tsx` — reworked into the merged navigator (PROJECTS + WORKSPACES, nested agents, info card).
- `src/components/TaskCard.tsx` — optional `repoName` badge.
- `src/components/IconRail.tsx` — drop `runningAgentsSlot` + the running-agents button.
- `src/components/MissionControl.tsx` — drop the `WorkspaceSwitcher` and its props.
- `src/hooks/useApp.ts` — `currentView "workspace"`, repurpose `activeWorkspaceId`, `workspaceBoardTasks`, retire scope-filter derivations, `openWorkspaceBoard`.
- `src/taskNavigation.ts` — `planTaskFocus` understands a `"workspace"` origin.
- `src/App.tsx` — persistent panel, workspace-board route, removed flyout/switcher wiring.
- `src/styles/redesign.css` — panel sections, nested rows, info card, repo badge.
- `src/test/appWorkspacesTests.tsx` — rework switcher-based tests for the new navigation.
- `docs/features.md`, `CLAUDE.md` — doc updates.

**Delete:**
- `src/components/RunningAgentsFlyout.tsx`
- `src/components/WorkspaceSwitcher.tsx`

---

## Task 1: Sidebar-agents grouping helper

**Files:**
- Create: `src/lib/sidebarAgents.ts`
- Test: `src/lib/sidebarAgents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sidebarAgents.test.ts
import { describe, expect, it } from "vitest";
import { buildSidebarAgents, dominantState } from "./sidebarAgents";
import type { Repo, TaskSummary, Workspace } from "../types";

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 1, repoId: 1, workspaceId: null, title: "T", prompt: null, status: "planned",
    taskRepos: [], prUrl: null, agentProfileId: 1, agentName: "Codex", agentKind: "codex",
    hasWorktree: false, branchName: null, worktreePath: null, isDirty: false,
    activeSessionId: null, lastSessionId: null, lastSessionAgent: null, lastSessionCwd: null,
    lastSessionLabel: null, createdAt: "2026-06-07T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}
const repos: Repo[] = [
  { id: 1, name: "alpha", path: "/a", defaultWorktreeRoot: "/a-wt", createdAt: "2026-06-07T00:00:00.000Z" },
  { id: 2, name: "beta", path: "/b", defaultWorktreeRoot: "/b-wt", createdAt: "2026-06-07T00:00:00.000Z" },
];
const workspaces: Workspace[] = [
  { id: 10, name: "Core", repoIds: [1, 2], createdAt: "x", updatedAt: "x" },
];

describe("buildSidebarAgents", () => {
  it("buckets only active agents by repo and unions them by workspace", () => {
    const tasks = [
      task({ id: 1, repoId: 1, activeSessionId: "s1" }), // running
      task({ id: 2, repoId: 2, status: "review" }),       // review
      task({ id: 3, repoId: 1, status: "done" }),         // terminal — excluded
    ];
    const { byRepo, byWorkspace } = buildSidebarAgents(tasks, [], repos, workspaces, {}, 0);

    expect(byRepo.get(1)?.map((r) => r.task.id)).toEqual([1]);
    expect(byRepo.get(2)?.map((r) => r.task.id)).toEqual([2]);
    expect(byWorkspace.get(10)?.map((r) => r.task.id).sort()).toEqual([1, 2]);
  });

  it("dominantState returns the most urgent active state present, else undefined", () => {
    const tasks = [task({ id: 1, repoId: 1, status: "review" }), task({ id: 2, repoId: 1, activeSessionId: "s" })];
    const { byRepo } = buildSidebarAgents(tasks, [], repos, workspaces, {}, 0);
    expect(dominantState(byRepo.get(1) ?? [])).toBe("running"); // running outranks review
    expect(dominantState([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/sidebarAgents.test.ts`
Expected: FAIL — `Cannot find module './sidebarAgents'`.

- [ ] **Step 3: Write the helper**

```ts
// src/lib/sidebarAgents.ts
import { ACTIVE_AGENT_STATES, buildAgentRows, type AgentRow, type AgentState } from "./agentState";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary, Workspace } from "../types";

export interface SidebarAgents {
  /** repoId -> active agent rows in that repo. */
  byRepo: Map<number, AgentRow[]>;
  /** workspaceId -> active agent rows across the workspace's repos (deduped). */
  byWorkspace: Map<number, AgentRow[]>;
}

/**
 * Bucket the in-flight agents ([[ACTIVE_AGENT_STATES]]) for the merged sidebar:
 * by their project, and by every workspace whose repo set contains that project.
 * An agent intentionally surfaces under both lenses.
 */
export function buildSidebarAgents(
  tasks: TaskSummary[],
  taskAttention: TaskAttention[],
  repos: Repo[],
  workspaces: Workspace[],
  liveLines: Record<number, string> = {},
  now = Date.now(),
): SidebarAgents {
  const repoNames = new Map(repos.map((repo) => [repo.id, repo.name]));
  const active = buildAgentRows(tasks, taskAttention, repoNames, liveLines, now).filter((row) =>
    ACTIVE_AGENT_STATES.includes(row.state),
  );

  const byRepo = new Map<number, AgentRow[]>();
  for (const row of active) {
    const list = byRepo.get(row.task.repoId);
    if (list) list.push(row);
    else byRepo.set(row.task.repoId, [row]);
  }

  const byWorkspace = new Map<number, AgentRow[]>();
  for (const workspace of workspaces) {
    const rows: AgentRow[] = [];
    for (const repoId of workspace.repoIds) {
      for (const row of byRepo.get(repoId) ?? []) rows.push(row);
    }
    byWorkspace.set(workspace.id, rows);
  }

  return { byRepo, byWorkspace };
}

/** The most urgent active state present in a row list, in priority order. */
export function dominantState(rows: AgentRow[]): AgentState | undefined {
  return ACTIVE_AGENT_STATES.find((state) => rows.some((row) => row.state === state));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/sidebarAgents.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sidebarAgents.ts src/lib/sidebarAgents.test.ts
git commit -m "feat(sidebar): add active-agent grouping helper for the merged panel"
```

---

## Task 2: Extract the shared `SidebarAgentRow`

The deleted flyout's `FlyRow` markup is reused verbatim for the nested rows. Extract it first so nothing is duplicated.

**Files:**
- Create: `src/components/SidebarAgentRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/SidebarAgentRow.tsx
import { GitBranch } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import type { AgentRow } from "../lib/agentState";
import type { AgentKind } from "../types";

/**
 * One in-flight agent, rendered as a compact card in the sidebar's nested agent
 * lists. Shares the `nx-fly-row*` vocabulary that the old running-agents popup
 * used, so "the same concept is the same hue" still holds. Clicking focuses the task.
 */
export function SidebarAgentRow({ row, onOpen }: { row: AgentRow; onOpen: () => void }) {
  const { task, state, line, elapsed, repoName } = row;
  const agentKind: AgentKind = task.agentKind ?? "custom";
  return (
    <button
      type="button"
      className="nx-fly-row"
      data-state={state}
      onClick={onOpen}
      aria-label={`Open ${task.title} (${repoName})`}
    >
      <div className="nx-fly-row-top">
        <span className="nx-fly-loc">
          <AgentLogo agentKind={agentKind} size="xs" />
          <span className="nx-fly-proj">{repoName}</span>
          {task.hasWorktree && task.branchName && (
            <>
              <GitBranch aria-hidden="true" />
              <span className="nx-fly-branch">{task.branchName}</span>
            </>
          )}
        </span>
        {state === "running" && <span className="nx-livedot live-dot" aria-hidden="true" />}
        {elapsed && <span className="nx-fly-time">{elapsed}</span>}
      </div>
      <div className="nx-fly-row-title">{task.title}</div>
      <div className="nx-fly-row-line">{state === "needs_you" ? `“${line}”` : line}</div>
    </button>
  );
}
```

- [ ] **Step 2: Verify it type-checks via the build (no test yet — exercised in Task 4)**

Run: `pnpm test -- src/lib/sidebarAgents.test.ts`
Expected: PASS (unchanged; this step only confirms the new file doesn't break the suite's transform).

- [ ] **Step 3: Commit**

```bash
git add src/components/SidebarAgentRow.tsx
git commit -m "feat(sidebar): extract shared SidebarAgentRow from the flyout markup"
```

---

## Task 3: `TaskCard` optional repo badge

Used by the workspace board to disambiguate cards across repos; the single-repo board passes nothing, so it is unchanged.

**Files:**
- Modify: `src/components/TaskCard.tsx`

- [ ] **Step 1: Add the prop**

In the `TaskCardProps` interface (after `liveLine?: string;`), add:

```tsx
  /** Repo label shown only on the workspace board to tell cards apart. */
  repoName?: string;
```

- [ ] **Step 2: Destructure it**

In the `TaskCard({ ... })` parameter list, add `repoName,` next to `liveLine,`.

- [ ] **Step 3: Render the badge in the card footer**

Replace the `nx-card-agent` span's opening so the repo badge renders first inside the footer's right group. Change:

```tsx
        <span className="nx-card-agent">
          {task.jiraIssueKey && (
```

to:

```tsx
        <span className="nx-card-agent">
          {repoName && <span className="nx-card-repo">{repoName}</span>}
          {task.jiraIssueKey && (
```

- [ ] **Step 4: Run the existing card/board tests to confirm no regression**

Run: `pnpm test -- src/App.test.tsx`
Expected: PASS (no card currently passes `repoName`, so output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskCard.tsx
git commit -m "feat(board): optional repo badge on TaskCard for the workspace board"
```

---

## Task 4: Rework `ProjectPanel` into the merged navigator

**Files:**
- Modify: `src/components/ProjectPanel.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
// src/components/ProjectPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { FolderGit2, Info, Plus, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { AGENT_STATE_META } from "../lib/agentState";
import { buildSidebarAgents, dominantState } from "../lib/sidebarAgents";
import type { AgentRow } from "../lib/agentState";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary, Workspace } from "../types";

interface ProjectPanelProps {
  repos: Repo[];
  workspaces: Workspace[];
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  liveLines: Record<number, string>;
  selectedRepoId?: number;
  /** The focused workspace whose board is open (none on Mission Control / project board). */
  selectedWorkspaceId?: number;
  onSelectRepo: (id: number) => void;
  onSelectWorkspace: (id: number) => void;
  onOpenTask: (id: number) => void;
  onAddProject: () => void;
  onManageWorkspaces: () => void;
  busy: boolean;
  loading: boolean;
}

/**
 * The persistent sidebar navigator: projects and workspaces, each opening its own
 * board, with that scope's in-flight agents nested inline. Replaces both the old
 * project rail and the rail's running-agents popup.
 */
export function ProjectPanel({
  repos,
  workspaces,
  tasks,
  taskAttention,
  liveLines,
  selectedRepoId,
  selectedWorkspaceId,
  onSelectRepo,
  onSelectWorkspace,
  onOpenTask,
  onAddProject,
  onManageWorkspaces,
  busy,
  loading,
}: ProjectPanelProps) {
  // The panel is always mounted, so it owns the elapsed-time tick (like Mission Control).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const repoNames = useMemo(() => new Map(repos.map((repo) => [repo.id, repo.name])), [repos]);
  const { byRepo, byWorkspace } = useMemo(
    () => buildSidebarAgents(tasks, taskAttention, repos, workspaces, liveLines, now),
    [tasks, taskAttention, repos, workspaces, liveLines, now],
  );

  return (
    <aside className="nx-panel" aria-label="Projects and workspaces">
      <div className="nx-panel-head">
        Nectus
        <button type="button" className="nx-panel-manage" onClick={onManageWorkspaces} aria-label="Manage workspaces">
          <Settings2 size={14} aria-hidden="true" />
          Manage
        </button>
      </div>

      <div className="nx-panel-scroll">
        <div className="nx-panel-sect">
          <div className="nx-panel-kick">
            <span>Projects</span>
            <button type="button" aria-label="Add project" onClick={onAddProject} disabled={busy}>
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
          {repos.length === 0 ? (
            <p className="nx-panel-empty">{loading ? "Loading projects…" : "Add a local git project to begin."}</p>
          ) : (
            repos.map((repo) => (
              <NavRow
                key={`repo-${repo.id}`}
                label={repo.name}
                icon={<FolderGit2 aria-hidden="true" />}
                active={repo.id === selectedRepoId}
                rows={byRepo.get(repo.id) ?? []}
                onSelect={() => onSelectRepo(repo.id)}
                onOpenTask={onOpenTask}
              />
            ))
          )}
        </div>

        {workspaces.length > 0 && (
          <div className="nx-panel-sect">
            <div className="nx-panel-kick">
              <span>Workspaces</span>
            </div>
            {workspaces.map((workspace) => (
              <NavRow
                key={`ws-${workspace.id}`}
                label={workspace.name}
                active={workspace.id === selectedWorkspaceId}
                rows={byWorkspace.get(workspace.id) ?? []}
                onSelect={() => onSelectWorkspace(workspace.id)}
                onOpenTask={onOpenTask}
                info={<WorkspaceInfo workspace={workspace} repoNames={repoNames} onSelectRepo={onSelectRepo} />}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function NavRow({
  label,
  icon,
  active,
  rows,
  onSelect,
  onOpenTask,
  info,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  rows: AgentRow[];
  onSelect: () => void;
  onOpenTask: (id: number) => void;
  info?: React.ReactNode;
}) {
  const tone = dominantState(rows);
  return (
    <div className="nx-nav-group">
      <button type="button" className="nx-proj" data-active={active} onClick={onSelect}>
        {icon}
        <span className="nx-proj-name">{label}</span>
        {info}
        {tone && <span className="nx-nav-dot" style={{ background: AGENT_STATE_META[tone].dot }} aria-hidden="true" />}
        <span className="nx-proj-count">{rows.length}</span>
      </button>
      {rows.length > 0 && (
        <div className="nx-nav-agents">
          {rows.map((row) => (
            <SidebarAgentRow key={row.task.id} row={row} onOpen={() => onOpenTask(row.task.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceInfo({
  workspace,
  repoNames,
  onSelectRepo,
}: {
  workspace: Workspace;
  repoNames: Map<number, string>;
  onSelectRepo: (id: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-nav-info"
          aria-label={`Projects in ${workspace.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="nx-info-card w-56 p-2">
        <div className="nx-info-title">{workspace.name}</div>
        {workspace.repoIds.length === 0 ? (
          <p className="nx-info-empty">No projects yet.</p>
        ) : (
          workspace.repoIds.map((repoId) => (
            <button key={repoId} type="button" className="nx-info-row" onClick={() => onSelectRepo(repoId)}>
              <FolderGit2 size={13} aria-hidden="true" />
              {repoNames.get(repoId) ?? `repo ${repoId}`}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Confirm the suite still transforms (App wiring updates land in Task 7)**

Run: `pnpm test -- src/lib/sidebarAgents.test.ts`
Expected: PASS. (App.test.tsx will not be green until Task 7 updates the call site — that is expected and handled there.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ProjectPanel.tsx
git commit -m "feat(sidebar): rework ProjectPanel into projects+workspaces navigator with nested agents"
```

---

## Task 5: `planTaskFocus` understands a workspace origin

**Files:**
- Modify: `src/taskNavigation.ts`

- [ ] **Step 1: Update the types and logic**

Replace the file with:

```ts
// src/taskNavigation.ts
export type AppView = "mission" | "board" | "workspace" | "settings" | "reviews" | "jira";

export interface TaskFocusPlan {
  // Repo to select, or undefined to leave the current selection alone.
  repoId?: number;
  // View to land on. A task workspace renders over Mission Control, a project
  // board, or a workspace board; any secondary view is routed to the board.
  view: "mission" | "board" | "workspace";
  // Whether to close the New Task composer, which otherwise overlays the
  // viewport and hides the task workspace.
  dismissComposer: boolean;
}

// Decides how to surface a task's workspace from anywhere in the app (board,
// Mission Control, a workspace board, a JIRA card, or an attention toast).
export function planTaskFocus(
  view: AppView,
  task: { repoId: number } | undefined,
  composerOpen: boolean,
): TaskFocusPlan {
  return {
    repoId: task?.repoId,
    view: view === "mission" || view === "board" || view === "workspace" ? view : "board",
    dismissComposer: composerOpen,
  };
}
```

- [ ] **Step 2: Run the suite**

Run: `pnpm test -- src/App.test.tsx`
Expected: still the pre-Task-7 state (some failures from the ProjectPanel prop change are acceptable here; this step only checks `taskNavigation` compiles). If `taskNavigation` has its own test file, run it: `pnpm test -- src/taskNavigation` and expect PASS.

- [ ] **Step 3: Commit**

```bash
git add src/taskNavigation.ts
git commit -m "feat(nav): planTaskFocus preserves a workspace-board origin"
```

---

## Task 6: `useApp` — workspace route, focused workspace, retire scope filter

**Files:**
- Modify: `src/hooks/useApp.ts`

- [ ] **Step 1: Widen the view union**

Change the `currentView` state declaration (≈ line 47):

```ts
  const [currentView, setCurrentView] = useState<
    "mission" | "board" | "workspace" | "settings" | "reviews" | "jira"
  >(
```

(keep the existing initial value expression that follows).

- [ ] **Step 2: Retire the scope-filter derivations**

Replace the block that defines `workspaceRepoIds`, `scopedRepos`, `missionTasks`, the keep-in-scope `useEffect`, and `visibleTasks` (≈ lines 132–165) with:

```ts
  // `activeWorkspace` is now the FOCUSED workspace (the one whose board is open),
  // not a global scope filter. Mission Control and the project list always show
  // every repo; per-workspace focus comes from the workspace board.
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  // The focused workspace's repos, offered as a multi-select in the composer so a
  // task can span several of them (cross-repo). Empty when no workspace board is open.
  const activeWorkspaceRepos = useMemo(
    () => (activeWorkspace ? repos.filter((repo) => activeWorkspace.repoIds.includes(repo.id)) : []),
    [activeWorkspace, repos],
  );
  // Mission Control shows every project's tasks (scope filter retired).
  const missionTasks = tasks;
  // The aggregated workspace board: all tasks whose repo is in the focused workspace.
  const workspaceBoardTasks = useMemo(
    () => (activeWorkspace ? tasks.filter((task) => activeWorkspace.repoIds.includes(task.repoId)) : []),
    [activeWorkspace, tasks],
  );

  const visibleTasks = useMemo(
    () => (selectedRepoId ? tasks.filter((task) => task.repoId === selectedRepoId) : tasks),
    [tasks, selectedRepoId],
  );
```

- [ ] **Step 3: Keep `scopedRepos` as an alias for the few remaining callers**

Some call sites (`openCreateTaskModal`, `navigate`) reference `scopedRepos[0]`. Scoping is retired, so it is simply all repos. Immediately after the block above, add:

```ts
  // Scoping retired: "scoped" repos are now just all repos. Kept as a named alias
  // so the composer / navigate fallbacks read clearly.
  const scopedRepos = repos;
```

- [ ] **Step 4: Add the workspace-board opener**

Find where other navigation setters live and add a callback (place it near `setActiveWorkspaceId` usage). Add this `useCallback` (import `useCallback` is already used in the file):

```ts
  // Open a workspace's aggregated board: focus it (drives the board contents and
  // the composer's cross-repo multi-select) and route to the workspace view.
  const openWorkspaceBoard = useCallback((workspaceId: number) => {
    setActiveWorkspaceId(workspaceId);
    setSelectedRepoId(undefined);
    setSelectedTaskId(undefined);
    setCurrentView("workspace");
  }, []);
```

- [ ] **Step 5: Export the new values**

In the hook's returned object (≈ lines 636–660), ensure these are present: add `workspaceBoardTasks,` and `openWorkspaceBoard,`. Keep returning `activeWorkspaceId`, `setActiveWorkspaceId`, `activeWorkspaceRepos`, `scopedRepos`, `missionTasks`, `visibleTasks` (signatures unchanged).

- [ ] **Step 6: Run the hook-dependent suite**

Run: `pnpm test -- src/App.test.tsx`
Expected: FAIL only in places that still reference the removed `WorkspaceSwitcher` / old wiring (fixed in Tasks 7–8). No TypeScript "cannot find name" errors for `workspaceBoardTasks` / `openWorkspaceBoard`.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useApp.ts
git commit -m "feat(state): focused-workspace model + workspaceBoardTasks, retire scope filter"
```

---

## Task 7: `App.tsx` — persistent panel, workspace board route, drop flyout/switcher

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

Remove:

```tsx
import { RunningAgentsFlyout } from "./components/RunningAgentsFlyout";
```

- [ ] **Step 2: Pull the new values from `useApp`**

In the `useApp()` destructure, add `workspaceBoardTasks,` and `openWorkspaceBoard,` (alongside the existing `missionTasks`, `activeWorkspaceId`, etc.).

- [ ] **Step 3: Replace visibility + frame derivation**

Replace the block (≈ lines 240–245):

```tsx
  const taskOpen = Boolean(selectedTask) && (currentView === "mission" || currentView === "board");
  const composing = createTaskOpen;
  const showProjectPanel = currentView === "board" && !taskOpen && !composing && !managingWorkspaces;
  const railActive: RailView = currentView;
  const frame = showProjectPanel ? "railp" : "rail";
```

with:

```tsx
  const taskOpen =
    Boolean(selectedTask) &&
    (currentView === "mission" || currentView === "board" || currentView === "workspace");
  const composing = createTaskOpen;
  // The merged navigator is persistent on the work views (Mission Control + both
  // boards), and hidden when a task / composer / workspace manager takes over.
  const showProjectPanel =
    (currentView === "mission" || currentView === "board" || currentView === "workspace") &&
    !taskOpen &&
    !composing &&
    !managingWorkspaces;
  // The workspace board is panel-driven, not a rail destination; map it to "board".
  const railActive: RailView = currentView === "workspace" ? "board" : currentView;
  const frame = showProjectPanel ? "railp" : "rail";
```

- [ ] **Step 4: Drop the flyout slot on `IconRail`**

In the `<IconRail ... />` element, remove the entire `runningAgentsSlot={ ... }` prop (the `<RunningAgentsFlyout .../>` block).

- [ ] **Step 5: Replace the `ProjectPanel` usage**

Replace the existing `{showProjectPanel && ( <ProjectPanel ... /> )}` block with:

```tsx
        {showProjectPanel && (
          <ProjectPanel
            repos={repos}
            workspaces={workspaces}
            tasks={tasks}
            taskAttention={taskAttention}
            liveLines={liveLines}
            selectedRepoId={currentView === "board" ? selectedRepoId : undefined}
            selectedWorkspaceId={currentView === "workspace" ? activeWorkspaceId : undefined}
            onSelectRepo={(id) => {
              setActiveWorkspaceId(undefined);
              setSelectedTaskId(undefined);
              setSelectedRepoId(id);
              setCurrentView("board");
            }}
            onSelectWorkspace={openWorkspaceBoard}
            onOpenTask={openTask}
            onAddProject={addProject}
            onManageWorkspaces={openManageWorkspaces}
            busy={busy}
            loading={loading}
          />
        )}
```

- [ ] **Step 6: Add the workspace-board view branch**

In the viewport conditional chain, add a branch for the workspace board. Place it immediately before the `currentView === "mission"` branch:

```tsx
          ) : currentView === "workspace" ? (
            <div className="nx-viewport-fill" data-testid="workspace-board">
              <Workspace
                selectedRepo={undefined}
                workspaceName={activeWorkspace?.name}
                visibleTasks={workspaceBoardTasks}
                repoNames={repos}
                selectedTaskId={selectedTaskId}
                taskAttention={taskAttention}
                liveLines={liveLines}
                onSelectTask={openTask}
                onRefresh={refresh}
                onCreateTask={openCreateTaskModal}
                onDeleteTask={requestDeleteTask}
                onUpdateStatus={updateStatus}
                deletingTaskIds={deletingTaskIds}
                busy={busy}
                loading={loading}
              />
            </div>
          ) : currentView === "mission" ? (
```

Note: `activeWorkspace` is not currently destructured in `App`. Add `activeWorkspace,` to the `useApp()` destructure (it is already part of the hook's internal state; export it from `useApp` if not already — add `activeWorkspace,` to the hook's return object in Task 6 Step 5 if missing).

- [ ] **Step 7: Update the `navigate` fallback**

The `navigate` function (≈ line 225) must clear the focused workspace when leaving via the rail, so Mission Control / a project board never keep a stale workspace focus. After `setSelectedTaskId(undefined);` inside `navigate`, add:

```tsx
    setActiveWorkspaceId(undefined);
```

- [ ] **Step 8: Run the suite**

Run: `pnpm test -- src/App.test.tsx`
Expected: FAIL only in `appWorkspacesTests` (still drives the deleted switcher) and `MissionControl` still importing `WorkspaceSwitcher` (Task 8). Smoke + board + creation groups should pass; if any now fail on duplicate text (panel repo names), note them for Task 9.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(shell): persistent navigator + workspace board route, drop running-agents popup"
```

---

## Task 8: Extend `Workspace.tsx` for the workspace board + retire `WorkspaceSwitcher`

**Files:**
- Modify: `src/components/Workspace.tsx`
- Modify: `src/components/MissionControl.tsx`
- Delete: `src/components/WorkspaceSwitcher.tsx`, `src/components/RunningAgentsFlyout.tsx`

- [ ] **Step 1: Add workspace-board props to `Workspace`**

In `WorkspaceProps`, add after `selectedRepo?: Repo;`:

```tsx
  /** When set, this board is a workspace board: header shows the name, cards show repo badges. */
  workspaceName?: string;
  /** All repos, used to label cards with their project name on the workspace board. */
  repoNames?: Repo[];
```

Destructure `workspaceName,` and `repoNames,` in the component signature.

- [ ] **Step 2: Build a repo-id→name lookup**

Near the top of the component body (after the existing `useState`/`useRef` lines), add:

```tsx
  const repoNameById = useMemo(
    () => new Map((repoNames ?? []).map((repo) => [repo.id, repo.name])),
    [repoNames],
  );
```

Add `useMemo` to the existing `react` import.

- [ ] **Step 3: Use the workspace name in the header + subtitle**

Change the `<h1>` content from:

```tsx
            {selectedRepo ? selectedRepo.name : loading ? "Loading projects…" : "Connect a project"}
```

to:

```tsx
            {workspaceName ?? (selectedRepo ? selectedRepo.name : loading ? "Loading projects…" : "Connect a project")}
```

And gate the empty state on neither being present — change the board render guard from `!selectedRepo ?` to:

```tsx
      ) : !selectedRepo && !workspaceName ? (
```

Show "New Task" when either a repo or a workspace is selected — change `{selectedRepo && (` (the New Task button guard) to `{(selectedRepo || workspaceName) && (`.

- [ ] **Step 4: Pass `repoName` to cards (workspace board only)**

In the `<TaskCard ... />` element, add:

```tsx
                        repoName={workspaceName ? repoNameById.get(task.repoId) : undefined}
```

- [ ] **Step 5: Retire `WorkspaceSwitcher` from Mission Control**

In `src/components/MissionControl.tsx`:
- Remove the import `import { WorkspaceSwitcher } from "./WorkspaceSwitcher";`.
- Remove `workspaces`, `activeWorkspaceId`, `onSelectWorkspace`, `onManageWorkspaces` from `MissionControlProps` and the component signature.
- Remove the `<WorkspaceSwitcher ... />` element from the header `nx-head-actions`, leaving just the Refresh button.

In `src/App.tsx`, the `<MissionControl ... />` call: remove the now-unused props `workspaces`, `activeWorkspaceId`, `onSelectWorkspace`, `onManageWorkspaces`.

- [ ] **Step 6: Delete the dead components**

```bash
git rm src/components/WorkspaceSwitcher.tsx src/components/RunningAgentsFlyout.tsx
```

- [ ] **Step 7: Build to catch dangling references**

Run: `pnpm build`
Expected: SUCCESS. If the build reports an unresolved import of `WorkspaceSwitcher`/`RunningAgentsFlyout`, remove that reference and rebuild.

- [ ] **Step 8: Commit**

```bash
git add src/components/Workspace.tsx src/components/MissionControl.tsx src/App.tsx
git commit -m "feat(board): workspace board in Workspace.tsx; retire WorkspaceSwitcher + flyout"
```

---

## Task 9: Rework the affected App tests

**Files:**
- Modify: `src/test/appWorkspacesTests.tsx`
- (Possibly) Modify: `src/test/appTaskBoardTests.tsx`, `src/test/appSmokeTests.tsx` — only to disambiguate text now duplicated by the panel.

- [ ] **Step 1: Replace the obsolete scope-filter test**

In `src/test/appWorkspacesTests.tsx`, delete the `"scopes Mission Control to the active workspace and back to all repos"` test entirely (scoping is retired). Replace it with a workspace-board navigation test:

```tsx
  it("opens a workspace board aggregating tasks from its repos, with repo badges", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Task in first repo" }),
      appTask({ id: 102, repoId: secondRepo.id, title: "Task in second repo" }),
    ]);

    render(<App />);

    // The Workspaces section row opens the aggregated board.
    fireEvent.click(await screen.findByText("Platform"));

    const board = await screen.findByTestId("workspace-board");
    expect(within(board).getByText("Task in first repo")).toBeInTheDocument();
    expect(within(board).getByText("Task in second repo")).toBeInTheDocument();
    // Cards carry their project name as a repo badge.
    expect(within(board).getByText(secondRepo.name)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Update the cross-repo composer tests to navigate via the workspace board**

In the `"creates a cross-repo task from the workspace composer"` test, replace:

```tsx
    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
```

with:

```tsx
    // Open the Platform workspace board, then its New Task composer (cross-repo context).
    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(await within(screen.getByTestId("workspace-board")).findByRole("button", { name: /new task/i }));
```

Apply the same replacement in `"selecting one repo in the workspace composer creates a worktree task on that repo"`.

- [ ] **Step 3: Run the workspaces group**

Run: `pnpm test -- src/App.test.tsx -t "workspace"`
Expected: PASS for the reworked workspace tests. The manager tests (`"creates a workspace from the manager"`, `"edits an existing workspace"`, `"disables creating…"`) are unaffected — `Manage workspaces` still exists (now the panel header button) and the `WorkspaceManager` is unchanged.

- [ ] **Step 4: Run the full frontend suite and disambiguate any duplicate-text failures**

Run: `pnpm test`
Expected: PASS. If a smoke/board test fails with "found multiple elements" for a repo name (now shown both in the panel and the board), scope that query with the view container, e.g.:

```tsx
const board = screen.getByTestId("dashboard-layout");
expect(within(board).getByText(appRepo.name)).toBeInTheDocument();
```

Fix each such occurrence; do not weaken assertions otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/test
git commit -m "test: cover workspace board navigation; drop retired scope-filter test"
```

---

## Task 10: Add focused tests for the merged panel

**Files:**
- Create: `src/test/appSidebarTests.tsx`
- Modify: `src/App.test.tsx` (register the group)

- [ ] **Step 1: Write the panel test group**

```tsx
// src/test/appSidebarTests.tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";
import type { Repo, Workspace } from "../types";

const mockedApi = vi.mocked(api);

const secondRepo: Repo = {
  id: 8, name: "second-repo", path: "/tmp/second-repo",
  defaultWorktreeRoot: "/tmp/second-repo-worktrees", createdAt: "2026-05-14T00:00:00.000Z",
};

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: 1, name: "Core", repoIds: [appRepo.id, secondRepo.id], createdAt: "x", updatedAt: "x", ...overrides };
}

export function defineAppSidebarTests() {
  it("lists projects and workspaces with active-agent counts in the persistent panel", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Running here", activeSessionId: "s-101" }),
    ]);

    render(<App />);

    const panel = await screen.findByRole("complementary", { name: "Projects and workspaces" });
    // Project row shows its name and its one active agent nested under it.
    expect(within(panel).getByText(appRepo.name)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Open Running here/ })).toBeInTheDocument();
    // Workspace section lists the workspace.
    expect(within(panel).getByText("Core")).toBeInTheDocument();
  });

  it("the workspace info card lists its projects", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Projects in Core" }));
    const card = await screen.findByText(secondRepo.name, { selector: ".nx-info-row" });
    expect(card).toBeInTheDocument();
  });

  it("hides the panel on Settings", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);

    render(<App />);
    expect(await screen.findByRole("complementary", { name: "Projects and workspaces" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("complementary", { name: "Projects and workspaces" })).not.toBeInTheDocument();
  });

  it("Mission Control no longer renders the workspace scope switcher", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace({ repoIds: [appRepo.id] })]);

    render(<App />);
    await screen.findByText("Mission Control");
    // "All repos" was the switcher's clear-filter pill; it must be gone.
    expect(screen.queryByRole("radio", { name: "All repos" })).not.toBeInTheDocument();
    expect(screen.queryByText("All repos")).not.toBeInTheDocument();
  });
}
```

- [ ] **Step 2: Register the group in `src/App.test.tsx`**

Add the import beside the others:

```tsx
import { defineAppSidebarTests } from "./test/appSidebarTests";
```

And call it inside the `describe("App", ...)` block after `defineAppWorkspacesTests();`:

```tsx
  defineAppSidebarTests();
```

- [ ] **Step 3: Run the new group**

Run: `pnpm test -- src/App.test.tsx -t "panel"`
Expected: PASS. Then run the sidebar-specific cases: `pnpm test -- src/App.test.tsx -t "info card"` and `-t "scope switcher"` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/test/appSidebarTests.tsx src/App.test.tsx
git commit -m "test(sidebar): cover the merged panel, info card, visibility, retired switcher"
```

---

## Task 11: Styling

**Files:**
- Modify: `src/styles/redesign.css`

- [ ] **Step 1: Replace the now-removed `.nx-panel-ws` / switcher rules and add the new panel rules**

In `src/styles/redesign.css`, delete the `.nx-panel-ws`, `.nx-panel-ws .nx-ws-switcher`, and `.nx-ws-switcher` rules (the switcher is gone). Update `.nx-panel-head` to host the Manage button and append the new classes. Replace the `.nx-panel-head` rule and add, after the existing `.nx-panel-empty` rule:

```css
.nx-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 14px 14px 8px; font-size: 18px; font-weight: 700; letter-spacing: -0.02em;
}
.nx-panel-manage {
  display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent;
  color: var(--muted-foreground); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
  padding: 4px 6px; border-radius: var(--radius-sm);
}
.nx-panel-manage:hover { background: color-mix(in srgb, var(--foreground) 7%, transparent); color: var(--foreground); }

/* Nav row group: the project/workspace button plus its nested agent list. */
.nx-nav-group { display: flex; flex-direction: column; }
.nx-nav-dot { width: 7px; height: 7px; border-radius: 999px; flex: none; margin-left: 4px; }
.nx-proj .nx-proj-count { margin-left: 6px; }
.nx-nav-info {
  display: grid; place-items: center; width: 18px; height: 18px; margin-left: auto; flex: none;
  border: none; background: transparent; color: var(--muted-foreground); border-radius: var(--radius-sm); cursor: pointer;
}
.nx-nav-info:hover { background: color-mix(in srgb, var(--foreground) 8%, transparent); color: var(--foreground); }
/* When the info button claims margin-left:auto, the dot/count sit after it. */
.nx-proj:has(.nx-nav-info) .nx-proj-count { margin-left: 6px; }
.nx-nav-agents { display: flex; flex-direction: column; gap: 6px; padding: 4px 4px 8px 10px; }

/* Workspace info card (popover). */
.nx-info-card { display: flex; flex-direction: column; gap: 2px; }
.nx-info-title { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground); padding: 2px 6px 4px; }
.nx-info-empty { padding: 4px 6px; font-size: 12px; color: var(--muted-foreground); }
.nx-info-row {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: none; background: transparent;
  border-radius: var(--radius-sm); color: var(--foreground); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-align: left;
}
.nx-info-row:hover { background: color-mix(in srgb, var(--foreground) 6%, transparent); }
.nx-info-row svg { opacity: .7; flex: none; }

/* Repo badge on workspace-board cards. */
.nx-card-repo {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600; color: var(--muted-foreground);
  padding: 1px 5px; border: 1px solid var(--border); border-radius: 999px;
}
```

- [ ] **Step 2: Confirm the build picks up the CSS**

Run: `pnpm build`
Expected: SUCCESS (CSS is bundled; no errors).

- [ ] **Step 3: Commit**

```bash
git add src/styles/redesign.css
git commit -m "style(sidebar): panel sections, nested agents, info card, repo badge"
```

---

## Task 12: Documentation

**Files:**
- Modify: `docs/features.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/features.md`**

Rewrite the sidebar / running-agents / workspaces description to state: the running-agents list is now a persistent left navigator (no popup); it lists **Projects** and **Workspaces**, each opening its own board, with that scope's in-flight agents nested inline; a workspace opens an **aggregated kanban across its repos** (cards show a repo badge); each workspace row has an **info card** listing its projects; the old `All repos` workspace scope-switcher is retired (Mission Control shows every project).

- [ ] **Step 2: Update `CLAUDE.md` frontend boundary map**

- Change the `IconRail.tsx` entry: drop "Hosts a running-agents slot"; it no longer renders the running-agents button.
- Remove the `RunningAgentsFlyout.tsx` and `WorkspaceSwitcher.tsx` bullets.
- Update the `ProjectPanel.tsx` bullet: "the persistent navigator — Projects + Workspaces, each opening its board, with each scope's in-flight agents nested inline and a workspace info card; replaces the running-agents popup."
- Add a `SidebarAgentRow.tsx` bullet and a `src/lib/sidebarAgents.ts` bullet.
- Note the new `currentView = "workspace"` route and the aggregated workspace board in the `App.tsx` / `Workspace.tsx` entries.
- Update the `useApp.ts` bullet: `activeWorkspaceId` is the focused workspace (drives the workspace board + composer cross-repo context), not a scope filter.

- [ ] **Step 3: Commit**

```bash
git add docs/features.md CLAUDE.md
git commit -m "docs: persistent sidebar navigator + workspace boards"
```

---

## Task 13: Full verification

- [ ] **Step 1: Frontend tests**

Run: `pnpm test`
Expected: PASS (all groups, incl. the new sidebar group). Vitest also runs nested-worktree copies (project memory) — a failure path under `.claude/worktrees/` is not this code.

- [ ] **Step 2: Frontend build**

Run: `pnpm build`
Expected: SUCCESS, no type errors, no unresolved imports.

- [ ] **Step 3: Rust tests (no-op confirmation)**

Run: `cd native && cargo test`
Expected: PASS — no Rust changed; this confirms nothing else regressed. Do **not** run `cargo fmt` (it rewrites vendored files).

- [ ] **Step 4: Manual smoke (optional, user-driven)**

Suggest to the user: `pnpm dev --host 127.0.0.1` and verify in the browser preview (seeded data) that the panel lists projects + workspaces with nested agents, a workspace opens the aggregated board with repo badges, and the info card lists projects. Do not start the dev server without the user's go-ahead.

---

## Self-Review (completed)

- **Spec coverage:** persistent merged panel (Tasks 4,7,11) · projects+workspaces navigation (4,6,7) · nested agents both lenses (1,2,4) · info card (4,11) · workspace aggregated board with repo badges (3,6,8) · panel visibility mission/board/workspace only (7,10) · retire scope switcher (6,8,10) · cross-repo create preserved (6,9) · docs (12) · verification (13). All spec sections map to a task.
- **Placeholder scan:** none — every code step ships real code; the one judgment step (Task 9 Step 4) gives the concrete `within(...)` remedy and expected failure text.
- **Type consistency:** `buildSidebarAgents`/`dominantState` (Task 1) used as-is in Task 4; `SidebarAgentRow` props (Task 2) match Task 4 usage; `ProjectPanel` props (Task 4) match the `App` call site (Task 7); `workspaceBoardTasks`/`openWorkspaceBoard`/`activeWorkspace` exported in Task 6 and consumed in Task 7; `Workspace` new props (`workspaceName`, `repoNames`) defined in Task 8 and passed in Task 7; `planTaskFocus` view union (Task 5) matches `currentView` (Task 6).
