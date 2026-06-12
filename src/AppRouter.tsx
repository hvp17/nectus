import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { IconRail, type RailView } from "./components/IconRail";
import { ProjectPanel } from "./components/ProjectPanel";
import { MissionControl } from "./components/MissionControl";
import { Workspace } from "./components/Workspace";
import { useEventBridge } from "./hooks/useEventBridge";
import { useShellBootstrap } from "./hooks/useShellBootstrap";
import { usePrReviews } from "./hooks/usePrReviews";
import { useTaskActions } from "./hooks/useTaskActions";
import { useTaskDeletion } from "./hooks/useTaskDeletion";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions";
import { useProjectActions } from "./hooks/useProjectActions";
import { useSidebarCollapse } from "./hooks/useSidebarCollapse";
import { useComposer } from "./hooks/useComposer";
import { useCommandPaletteShortcut } from "./hooks/useCommandPaletteShortcut";
import { useJiraBoardView } from "./hooks/useJiraBoardView";
import { useSettingsActions } from "./hooks/useSettingsActions";
import { useJiraToken } from "./hooks/useJiraToken";
import { useQueryClient } from "@tanstack/react-query";
import { makeCacheSetter } from "./queries/cache";
import { queryKeys } from "./queries/keys";
import { useGithubStatusQuery } from "./queries/github";
import { useJiraRestStatusQuery } from "./queries/jira";
import type { AppSettings } from "./types";
import {
  useAgentProfilesQuery,
  useArchivedTasksQuery,
  useReposQuery,
  useSettingsQuery,
  useTasksQuery,
  useWorkspacesQuery,
  useBootstrapLoading,
  useRefreshData,
} from "./queries/core";
import { useAppStore } from "./store/appStore";
import { getAttentionCounts } from "./sessionAttention";
import type { AgentProfile, Repo, TaskSummary, Workspace as WorkspaceModel } from "./types";
import { useAppTheme } from "./hooks/useAppTheme";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useAppUpdateToast } from "./hooks/useAppUpdateToast";
import { useTaskNotificationToast } from "./hooks/useTaskNotificationToast";
import { formatNotificationBody } from "./notificationText";
import { planTaskFocus } from "./taskNavigation";
import { openExternal } from "./lib/openExternal";
import { resolveAgentProfileId } from "./lib/agentProfiles";
import { cn } from "./lib/utils";
import { api } from "./api";

/**
 * Fills the viewport: the wrapper flexes into the remaining space and every
 * direct child stretches to the full area.
 */
const VIEWPORT_FILL = "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden *:min-h-0 *:min-w-0 *:flex-1";

const SettingsPage = lazy(() =>
  import("./components/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const ReviewsPage = lazy(() =>
  import("./components/ReviewsPage").then((module) => ({ default: module.ReviewsPage })),
);
const JiraBoardPage = lazy(() =>
  import("./components/JiraBoardPage").then((module) => ({ default: module.JiraBoardPage })),
);
const TaskWorkspaceOverlay = lazy(() =>
  import("./components/TaskWorkspaceOverlay").then((module) => ({ default: module.TaskWorkspaceOverlay })),
);
const CreateTaskComposer = lazy(() =>
  import("./components/CreateTaskComposer").then((module) => ({ default: module.CreateTaskComposer })),
);
const WorkspaceManager = lazy(() =>
  import("./components/WorkspaceManager").then((module) => ({ default: module.WorkspaceManager })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);

function getToastContent(message: string) {
  const separator = message.indexOf(": ");
  if (separator > 0) {
    return {
      title: message.slice(0, separator),
      body: formatNotificationBody(message.slice(separator + 2)),
      kind: "success" as const,
    };
  }
  return {
    title: "Nectus",
    body: formatNotificationBody(message),
    kind: "info" as const,
  };
}

interface AppContextValue {
  openTask: (taskId: number) => void;
  openCreateTaskModal: () => void;
  appUpdate: ReturnType<typeof useAppUpdate>;
}

const AppContext = createContext<AppContextValue | null>(null);

function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppContext must be used within the app layout");
  return value;
}

/**
 * The persistent shell layout. Composes its data from queries + the store, owns the
 * app-level handlers, and renders either an overlay (composer / workspace manager /
 * open task) or the current view directly. `currentView` in the store is the single
 * source of truth — there is no router (the desktop shell has no URL bar).
 */
export function AppLayout() {
  // Single, mount-once subscription to all Tauri session/review/PR events, and the
  // boot-time default selection.
  useEventBridge();
  useShellBootstrap();
  const workspaceActions = useWorkspaceActions();
  const { addProject, renameProject, removeProject } = useProjectActions();
  const { setRepoCollapsed, setWorkspaceCollapsed } = useSidebarCollapse();

  // Server reads (queries) + shell UI state (store) — the shell composes its own
  // data directly now that `useApp` is gone.
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const workspaces = useWorkspacesQuery().data ?? EMPTY_WORKSPACES;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const settings = useSettingsQuery().data;
  const loading = useBootstrapLoading();
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const openWorkspaceBoard = useAppStore((s) => s.openWorkspaceBoard);
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const setSelectedRepoId = useAppStore((s) => s.setSelectedRepoId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const message = useAppStore((s) => s.message);
  const setMessage = useAppStore((s) => s.setMessage);
  const taskToast = useAppStore((s) => s.taskToast);
  const setTaskToast = useAppStore((s) => s.setTaskToast);
  const busy = useAppStore((s) => s.busy);
  // Select just the badge count, not the attention array: the shell must NOT
  // re-render on every hot runtime update (`liveLines` changes on every agent
  // output line). Components that display live data subscribe themselves.
  const needsInputCount = useAppStore((s) => getAttentionCounts(s.taskAttention).needsInput);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  const activeWorkspaceRepos = useMemo(
    () => (activeWorkspace ? repos.filter((repo) => activeWorkspace.repoIds.includes(repo.id)) : EMPTY_REPOS),
    [activeWorkspace, repos],
  );
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [tasks, selectedTaskId]);

  // The New Task composer draft now lives in the store; AppLayout owns only the
  // open/close trigger (the overlay itself is self-sufficient via `ComposerOverlay`).
  const createTaskOpen = useAppStore((s) => s.createTaskOpen);
  const setCreateTaskOpen = useAppStore((s) => s.setCreateTaskOpen);
  const newTaskAgentProfileId = useAppStore((s) => s.newTaskAgentProfileId);
  const setNewTaskAgentProfileId = useAppStore((s) => s.setNewTaskAgentProfileId);
  const setNewTaskRepoId = useAppStore((s) => s.setNewTaskRepoId);
  const setNewTaskWorkspaceId = useAppStore((s) => s.setNewTaskWorkspaceId);
  const closeComposerAction = useAppStore((s) => s.closeComposer);
  const selectedAgentProfileId = useAppStore((s) => s.selectedAgentProfileId);
  const composerDefaultAgent = resolveAgentProfileId(
    agentProfiles,
    settings?.defaultAgentProfileId,
    selectedAgentProfileId,
  );
  const composerOpenAgent = resolveAgentProfileId(
    agentProfiles,
    newTaskAgentProfileId,
    settings?.defaultAgentProfileId,
    selectedAgentProfileId,
  );

  useAppTheme(settings);

  // The workspace manager overlays the current view, like the New Task composer.
  const [managingWorkspaces, setManagingWorkspaces] = useState(false);
  // The ⌘K command palette is lazy-mounted only while open, so the global
  // toggle shortcut lives here in the always-mounted shell, not in the palette.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useCommandPaletteShortcut(togglePalette);

  // Close the composer and reset the whole draft (incl. the cross-repo selection)
  // in one store action, so a selection can't leak across opens.
  const closeComposer = useCallback(
    () => closeComposerAction(composerDefaultAgent),
    [closeComposerAction, composerDefaultAgent],
  );

  useEffect(() => {
    if (!message) return;
    const content = getToastContent(message);
    toast[content.kind](content.title, { description: content.body, duration: 5000 });
    setMessage(null);
  }, [message, setMessage]);

  // Open the New Task composer. With no target it inherits the focused board's scope;
  // a `repoId`/`workspaceId` target preselects that project (Project mode) or workspace
  // (cross-repo mode when it has ≥2 known repos, else Project mode on its sole member).
  // The sidebar rows' per-scope "+" actions pass a target; the rail passes none.
  const openComposer = useCallback(
    (target?: { repoId?: number; workspaceId?: number }) => {
      if (composerOpenAgent !== newTaskAgentProfileId) setNewTaskAgentProfileId(composerOpenAgent);
      // Reachable from the icon rail / sidebar while a task or the workspace manager is
      // open, so dismiss the manager before the composer overlays the view.
      setManagingWorkspaces(false);

      if (target?.workspaceId != null) {
        const workspace = workspaces.find((item) => item.id === target.workspaceId);
        const memberRepoIds = workspace
          ? workspace.repoIds.filter((id) => repos.some((repo) => repo.id === id))
          : [];
        // Only a workspace that can fan out (≥2 known repos) opens in cross-repo mode.
        setNewTaskWorkspaceId(memberRepoIds.length >= 2 ? target.workspaceId : undefined);
        setNewTaskRepoId(memberRepoIds[0] ?? selectedRepoId ?? repos[0]?.id);
        setCreateTaskOpen(true);
        return;
      }

      if (target?.repoId != null) {
        setNewTaskWorkspaceId(undefined);
        setNewTaskRepoId(target.repoId);
        setCreateTaskOpen(true);
        return;
      }

      // No target: fall back to the first available repo and default the scope to the
      // focused workspace board (cross-repo) only when it resolves to ≥2 repos.
      setNewTaskRepoId(selectedRepoId ?? activeWorkspaceRepos[0]?.id ?? repos[0]?.id);
      setNewTaskWorkspaceId(activeWorkspaceRepos.length >= 2 ? activeWorkspaceId : undefined);
      setCreateTaskOpen(true);
    },
    [
      newTaskAgentProfileId,
      composerOpenAgent,
      setNewTaskAgentProfileId,
      workspaces,
      repos,
      setNewTaskWorkspaceId,
      setNewTaskRepoId,
      selectedRepoId,
      activeWorkspaceRepos,
      activeWorkspaceId,
      setCreateTaskOpen,
    ],
  );

  const openCreateTaskModal = useCallback(() => openComposer(), [openComposer]);

  // Open the workspace manager, dismissing the New Task composer / open task that
  // would otherwise overlay it.
  const openManageWorkspaces = () => {
    if (createTaskOpen) closeComposer();
    setSelectedTaskId(undefined);
    setManagingWorkspaces(true);
  };

  // Focus a task into the workspace from anywhere (Mission Control, board, JIRA
  // card, or an attention toast). Dismissing the composer matters because it
  // overlays the viewport and would otherwise hide the task we just opened.
  const openTask = useCallback(
    (taskId: number) => {
      const task = tasks.find((item) => item.id === taskId);
      // A stale toast or JIRA card can reference a just-deleted task; don't leave
      // a dangling selection or switch views for a task that no longer exists.
      if (!task) return;
      const plan = planTaskFocus(currentView, task, createTaskOpen);
      if (plan.dismissComposer) closeComposer();
      setManagingWorkspaces(false);
      if (plan.repoId !== undefined) setSelectedRepoId(plan.repoId);
      setSelectedTaskId(taskId);
      setCurrentView(plan.view);
    },
    [tasks, currentView, createTaskOpen, closeComposer, setSelectedRepoId, setSelectedTaskId, setCurrentView],
  );

  // A finished / needs-input notification opens that task's workspace on click.
  const clearTaskToast = useCallback(() => setTaskToast(null), [setTaskToast]);
  useTaskNotificationToast({ notification: taskToast, onOpenTask: openTask, onShown: clearTaskToast });

  const appUpdate = useAppUpdate();
  useAppUpdateToast({
    status: appUpdate.status,
    info: appUpdate.info,
    onInstall: appUpdate.installUpdate,
    onRelaunch: appUpdate.relaunch,
  });

  // Top-level rail navigation. Board needs a selected project to show its kanban.
  const handleNavigate = (view: RailView) => {
    // The composer, workspace manager, and task workspace overlay the routed
    // view, so leaving via the rail must dismiss them.
    if (createTaskOpen) closeComposer();
    setManagingWorkspaces(false);
    setSelectedTaskId(undefined);
    setActiveWorkspaceId(undefined);
    // Fall back to the first available repo so the board always has a project selected.
    if (view === "board" && selectedRepoId === undefined && repos[0]) {
      setSelectedRepoId(repos[0].id);
    }
    setCurrentView(view);
  };

  // Palette navigation that mirrors the project-panel selection + dismiss logic, so
  // jumping to a project/workspace from ⌘K behaves like clicking it in the navigator.
  const openProjectBoard = (repoId: number) => {
    if (createTaskOpen) closeComposer();
    setManagingWorkspaces(false);
    setActiveWorkspaceId(undefined);
    setSelectedTaskId(undefined);
    setSelectedRepoId(repoId);
    setCurrentView("board");
  };
  const openWorkspaceFromPalette = (workspaceId: number) => {
    if (createTaskOpen) closeComposer();
    setManagingWorkspaces(false);
    openWorkspaceBoard(workspaceId);
  };

  // A task is opened on top of Mission Control or the board, never the secondary views.
  const taskOpen =
    Boolean(selectedTask) &&
    (currentView === "mission" || currentView === "board" || currentView === "workspace");
  const composing = createTaskOpen;
  // The merged navigator is persistent on the work views (Mission Control + both
  // boards) AND while a task is open, hidden only when the composer / workspace
  // manager takes over.
  const showProjectPanel =
    (currentView === "mission" || currentView === "board" || currentView === "workspace") &&
    !composing &&
    !managingWorkspaces;
  // The workspace board is panel-driven, not a rail destination; map it to "board".
  const railActive: RailView = currentView === "workspace" ? "board" : currentView;
  const frame = showProjectPanel ? "railp" : "rail";

  let viewport: ReactNode;
  if (composing) {
    viewport = <ComposerOverlay onClose={closeComposer} />;
  } else if (managingWorkspaces) {
    viewport = (
      <WorkspaceManager
        workspaces={workspaces}
        repos={repos}
        busy={busy}
        onClose={() => setManagingWorkspaces(false)}
        onCreate={workspaceActions.createWorkspace}
        onUpdate={workspaceActions.updateWorkspace}
        onDelete={workspaceActions.deleteWorkspace}
      />
    );
  } else if (taskOpen && selectedTask) {
    viewport = (
      <div className={VIEWPORT_FILL} data-testid="dashboard-layout" data-task-workspace="true">
        <TaskWorkspaceOverlay
          task={selectedTask}
          backLabel={
            currentView === "mission"
              ? "Mission Control"
              : currentView === "workspace"
                ? activeWorkspace?.name ?? "Workspace"
                : selectedRepo?.name ?? "Board"
          }
          repoName={repos.find((repo) => repo.id === selectedTask.repoId)?.name}
          onClose={() => setSelectedTaskId(undefined)}
        />
      </div>
    );
  } else if (currentView === "board") {
    viewport = <BoardView />;
  } else if (currentView === "workspace") {
    viewport = <WorkspaceView />;
  } else if (currentView === "settings") {
    viewport = <SettingsView />;
  } else if (currentView === "reviews") {
    viewport = <ReviewsView />;
  } else if (currentView === "jira") {
    viewport = <JiraView />;
  } else {
    viewport = <MissionView />;
  }

  const contextValue: AppContextValue = { openTask, openCreateTaskModal, appUpdate };

  return (
    <AppContext.Provider value={contextValue}>
      <div
        className={cn(
          "app-shell relative isolate grid h-full min-h-dvh w-full min-w-0 items-stretch overflow-hidden bg-background font-sans text-foreground",
          // Frame columns: icon rail + viewport, with the navigator panel slotted in
          // on the work views ("railp") — collapsed away again under 961px wide.
          // The panel column matches shadcn's SIDEBAR_WIDTH (16rem).
          "grid-cols-[52px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] min-[961px]:data-[frame=railp]:grid-cols-[52px_16rem_minmax(0,1fr)]",
          `density-${settings?.density ?? "comfortable"}`,
        )}
        data-frame={frame}
      >
        <IconRail
          active={railActive}
          needsCount={needsInputCount}
          onNavigate={handleNavigate}
          onCreateTask={openCreateTaskModal}
          canCreateTask={repos.length > 0}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        {showProjectPanel && (
          <ProjectPanel
            repos={repos}
            workspaces={workspaces}
            tasks={tasks}
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
            onCreateTaskForRepo={(id) => openComposer({ repoId: id })}
            onCreateTaskForWorkspace={(id) => openComposer({ workspaceId: id })}
            onAddProject={addProject}
            onRenameProject={renameProject}
            onRemoveProject={removeProject}
            onManageWorkspaces={openManageWorkspaces}
            onToggleRepoCollapse={setRepoCollapsed}
            onToggleWorkspaceCollapse={setWorkspaceCollapsed}
            busy={busy}
            loading={loading}
          />
        )}

        <div className="relative flex h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden *:min-h-0 *:min-w-0 *:flex-1">
          <Suspense fallback={<div className={VIEWPORT_FILL} />}>{viewport}</Suspense>
        </div>

        <Toaster closeButton theme={settings?.theme ?? "system"} />
      </div>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            repos={repos}
            workspaces={workspaces}
            tasks={tasks}
            canCreateTask={repos.length > 0}
            onNavigate={handleNavigate}
            onOpenProject={openProjectBoard}
            onOpenWorkspace={openWorkspaceFromPalette}
            onOpenTask={openTask}
            onCreateTask={openCreateTaskModal}
          />
        </Suspense>
      )}
    </AppContext.Provider>
  );
}

const EMPTY_REPOS: Repo[] = [];
const EMPTY_WORKSPACES: WorkspaceModel[] = [];
const EMPTY_TASKS: TaskSummary[] = [];

function MissionView() {
  // Reads server state from queries and runtime state from the store directly —
  // only the cross-cutting `openTask` handler comes from the layout.
  const { openTask } = useAppContext();
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const taskAttention = useAppStore((s) => s.taskAttention);
  const liveLines = useAppStore((s) => s.liveLines);
  const loading = useBootstrapLoading();
  const refresh = useRefreshData();
  return (
    <div className={VIEWPORT_FILL} data-testid="mission-control">
      <MissionControl
        repos={repos}
        tasks={tasks}
        taskAttention={taskAttention}
        liveLines={liveLines}
        loading={loading}
        onOpenTask={openTask}
        onOpenPr={openExternal}
        onRefresh={refresh}
      />
    </div>
  );
}

function BoardView() {
  const { openTask, openCreateTaskModal } = useAppContext();
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const taskAttention = useAppStore((s) => s.taskAttention);
  const liveLines = useAppStore((s) => s.liveLines);
  const deletingTaskIds = useAppStore((s) => s.deletingTaskIds);
  const busy = useAppStore((s) => s.busy);
  const loading = useBootstrapLoading();
  const refresh = useRefreshData();
  const { updateStatus, setArchived } = useTaskActions();
  const requestDeleteTask = useTaskDeletion();
  const archive = useBoardArchiveToggle();
  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);
  const sourceTasks = archive.showArchived ? archive.archivedTasks : tasks;
  const visibleTasks = useMemo(
    () => (selectedRepoId ? sourceTasks.filter((task) => task.repoId === selectedRepoId) : sourceTasks),
    [sourceTasks, selectedRepoId],
  );
  return (
    <div className={VIEWPORT_FILL} data-testid="dashboard-layout" data-task-workspace="false">
      <Workspace
        selectedRepo={selectedRepo}
        visibleTasks={visibleTasks}
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
        loading={loading || archive.loading}
        showArchived={archive.showArchived}
        onToggleArchived={archive.toggle}
        onUnarchiveTask={(task) => setArchived(task, false)}
      />
    </div>
  );
}

/** Shared archive-view state for the project and workspace boards. */
function useBoardArchiveToggle() {
  const [showArchived, setShowArchived] = useState(false);
  const archivedQuery = useArchivedTasksQuery(showArchived);
  return {
    showArchived,
    toggle: () => setShowArchived((current) => !current),
    archivedTasks: archivedQuery.data ?? EMPTY_TASKS,
    loading: showArchived && archivedQuery.isLoading,
  };
}

function WorkspaceView() {
  const { openTask, openCreateTaskModal } = useAppContext();
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const workspaces = useWorkspacesQuery().data ?? EMPTY_WORKSPACES;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const taskAttention = useAppStore((s) => s.taskAttention);
  const liveLines = useAppStore((s) => s.liveLines);
  const deletingTaskIds = useAppStore((s) => s.deletingTaskIds);
  const busy = useAppStore((s) => s.busy);
  const loading = useBootstrapLoading();
  const refresh = useRefreshData();
  const { updateStatus, setArchived } = useTaskActions();
  const requestDeleteTask = useTaskDeletion();
  const archive = useBoardArchiveToggle();
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  const sourceTasks = archive.showArchived ? archive.archivedTasks : tasks;
  const workspaceBoardTasks = useMemo(
    () =>
      activeWorkspace
        ? sourceTasks.filter((task) => activeWorkspace.repoIds.includes(task.repoId))
        : EMPTY_TASKS,
    [activeWorkspace, sourceTasks],
  );
  return (
    <div className={VIEWPORT_FILL} data-testid="workspace-board">
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
        loading={loading || archive.loading}
        showArchived={archive.showArchived}
        onToggleArchived={archive.toggle}
        onUnarchiveTask={(task) => setArchived(task, false)}
      />
    </div>
  );
}

function SettingsView() {
  const { appUpdate } = useAppContext();
  const settings = useSettingsQuery().data;
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const githubStatus = useGithubStatusQuery().data;
  const jiraRestStatus = useJiraRestStatusQuery().data;
  const busy = useAppStore((s) => s.busy);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const { saveAppSettings, saveAgentProfile } = useSettingsActions();
  const { setApiToken, clearApiToken } = useJiraToken();
  return (
    <SettingsPage
      settings={settings}
      agentProfiles={agentProfiles}
      githubStatus={githubStatus}
      jiraRestStatus={jiraRestStatus}
      appUpdate={appUpdate}
      busy={busy}
      onBack={() => setCurrentView("mission")}
      onSaveSettings={saveAppSettings}
      onSaveAgentProfile={saveAgentProfile}
      onSaveJiraToken={setApiToken}
      onDisconnectJira={clearApiToken}
    />
  );
}

function JiraView() {
  // Owns the JIRA board directly via useJiraBoardView; "create task from story" is
  // the composer's, and the agent pick is the store's composer-agent.
  const { openTask } = useAppContext();
  const composer = useComposer();
  const queryClient = useQueryClient();
  const setMessage = useAppStore((s) => s.setMessage);
  const newTaskAgentProfileId = useAppStore((s) => s.newTaskAgentProfileId);
  const setNewTaskAgentProfileId = useAppStore((s) => s.setNewTaskAgentProfileId);
  const settings = useSettingsQuery().data;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const setSettings = useMemo(
    () => makeCacheSetter<AppSettings | undefined>(queryClient, queryKeys.settings()),
    [queryClient],
  );
  const jiraBoard = useJiraBoardView({ active: true, settings, setSettings, setMessage });
  const jira = jiraBoard.jira;
  const jiraLaunchAgentProfileId = resolveAgentProfileId(
    agentProfiles,
    newTaskAgentProfileId,
    settings?.defaultAgentProfileId,
  );
  return (
    <JiraBoardPage
      projects={jira.projects}
      tasks={tasks}
      onOpenTask={openTask}
      project={settings?.jiraBoardProject ?? null}
      filters={{
        myIssues: settings?.jiraFilterMyIssues ?? false,
        unresolved: settings?.jiraFilterUnresolved ?? true,
        currentSprint: settings?.jiraFilterCurrentSprint ?? false,
        statuses: settings?.jiraFilterStatuses ?? [],
        epic: settings?.jiraFilterEpic ?? null,
      }}
      columns={jira.columns}
      loading={jira.loading}
      viewMode={jiraBoard.viewMode}
      onChangeViewMode={jiraBoard.setViewMode}
      sprintLanes={jira.sprintLanes}
      sprintLoading={jira.sprintLoading}
      sprintError={jira.sprintError}
      onChangeConfig={jiraBoard.setBoardConfig}
      onRefresh={jiraBoard.viewMode === "sprint" ? jira.refreshSprintBoard : jira.refresh}
      onTransition={jira.transition}
      onOpenItem={jiraBoard.openItem}
      onCreateTask={(item, agentProfileId) => {
        jiraBoard.setSelectedItem(null);
        void composer.createTaskFromStory(item, agentProfileId ?? jiraLaunchAgentProfileId);
      }}
      selectedItem={jiraBoard.selectedItem}
      onCloseItem={() => jiraBoard.setSelectedItem(null)}
      createOpen={jiraBoard.createOpen}
      onOpenCreate={jiraBoard.openCreate}
      onCloseCreate={jiraBoard.closeCreate}
      onCreateWorkItem={jiraBoard.createWorkItem}
      agentProfiles={agentProfiles}
      selectedAgentProfileId={jiraLaunchAgentProfileId}
      site={jira.site}
      restConnected={jira.restConnected}
      onListTransitions={api.jiraListTransitions}
      filterableStatuses={
        jira.restConnected
          ? jira.projectStatuses.map((status) => status.name)
          : jira.columns.map((column) => column.statusName)
      }
      epics={jira.epics}
      onAssign={jira.assign}
      onComment={jira.comment}
      onPickAgent={setNewTaskAgentProfileId}
      onOpenUrl={openExternal}
    />
  );
}

const EMPTY_PROFILES: AgentProfile[] = [];

function ComposerOverlay({ onClose }: { onClose: () => void }) {
  // Self-sufficient New Task composer: the draft lives in the store, the submit
  // logic in useComposer, and the reference data in queries.
  const composer = useComposer();
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const workspaces = useWorkspacesQuery().data ?? EMPTY_WORKSPACES;
  const settings = useSettingsQuery().data;
  const busy = useAppStore((s) => s.busy);
  const taskCreationStatus = useAppStore((s) => s.taskCreationStatus);
  const newTaskTitle = useAppStore((s) => s.newTaskTitle);
  const setNewTaskTitle = useAppStore((s) => s.setNewTaskTitle);
  const newTaskPrompt = useAppStore((s) => s.newTaskPrompt);
  const setNewTaskPrompt = useAppStore((s) => s.setNewTaskPrompt);
  const newTaskBranchName = useAppStore((s) => s.newTaskBranchName);
  const setNewTaskBranchName = useAppStore((s) => s.setNewTaskBranchName);
  const newTaskHasWorktree = useAppStore((s) => s.newTaskHasWorktree);
  const setNewTaskHasWorktree = useAppStore((s) => s.setNewTaskHasWorktree);
  const newTaskAgentProfileId = useAppStore((s) => s.newTaskAgentProfileId);
  const setNewTaskAgentProfileId = useAppStore((s) => s.setNewTaskAgentProfileId);
  const newTaskRepoId = useAppStore((s) => s.newTaskRepoId);
  const setNewTaskRepoId = useAppStore((s) => s.setNewTaskRepoId);
  const newTaskRepoIds = useAppStore((s) => s.newTaskRepoIds);
  const setNewTaskRepoIds = useAppStore((s) => s.setNewTaskRepoIds);
  const newTaskWorkspaceId = useAppStore((s) => s.newTaskWorkspaceId);
  const setNewTaskWorkspaceId = useAppStore((s) => s.setNewTaskWorkspaceId);
  const pendingJiraLink = useAppStore((s) => s.pendingJiraLink);
  return (
    <CreateTaskComposer
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void composer.createTask();
      }}
      agentProfiles={agentProfiles}
      repos={repos}
      busy={busy}
      creationStatus={taskCreationStatus}
      newTaskTitle={newTaskTitle}
      setNewTaskTitle={setNewTaskTitle}
      newTaskPrompt={newTaskPrompt}
      setNewTaskPrompt={setNewTaskPrompt}
      newTaskBranchName={newTaskBranchName}
      setNewTaskBranchName={setNewTaskBranchName}
      newTaskHasWorktree={newTaskHasWorktree}
      setNewTaskHasWorktree={setNewTaskHasWorktree}
      suggestedBranchName={composer.getSuggestedBranchName(settings?.defaultBranchPrefix)}
      newTaskAgentProfileId={newTaskAgentProfileId}
      setNewTaskAgentProfileId={setNewTaskAgentProfileId}
      newTaskRepoId={newTaskRepoId}
      setNewTaskRepoId={setNewTaskRepoId}
      linkedJiraKey={pendingJiraLink?.key ?? null}
      workspaces={workspaces}
      newTaskWorkspaceId={newTaskWorkspaceId}
      setNewTaskWorkspaceId={setNewTaskWorkspaceId}
      selectedRepoIds={newTaskRepoIds}
      onSetRepoIds={setNewTaskRepoIds}
    />
  );
}

function ReviewsView() {
  // Dissolved off `useApp`: this view owns the PR-review concern directly. The
  // event bridge keeps the list cache live, so `usePrReviews` is safe here even
  // though the view only mounts on the /reviews route.
  const setMessage = useAppStore((s) => s.setMessage);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const settings = useSettingsQuery().data;
  const pr = usePrReviews({ onMessage: setMessage });
  return (
    <ReviewsPage
      prReviews={pr.prReviews}
      selectedPrReview={pr.selectedPrReview}
      selectedPrReviewId={pr.selectedPrReviewId}
      selectedPrReviewRuns={pr.selectedPrReviewRuns}
      liveReviewOutput={pr.liveReviewOutput}
      agentProfiles={agentProfiles}
      defaultReviewerProfileId={resolveAgentProfileId(agentProfiles, settings?.defaultAgentProfileId)}
      creatingReview={pr.creatingReview}
      onSelectReview={pr.setSelectedPrReviewId}
      onCreateReview={pr.createPrReview}
      onRerunReview={pr.rerunPrReview}
      onDeleteReview={pr.deletePrReview}
      onPostReview={pr.postReviewComment}
      onBack={() => setCurrentView("mission")}
    />
  );
}
