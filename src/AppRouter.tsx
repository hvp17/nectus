import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { IconRail, type RailView } from "./components/IconRail";
import { ProjectPanel } from "./components/ProjectPanel";
import { MissionControl } from "./components/MissionControl";
import { Workspace } from "./components/Workspace";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { CreateTaskComposer } from "./components/CreateTaskModal";
import { WorkspaceManager } from "./components/WorkspaceManager";
import { SettingsPage } from "./components/SettingsPage";
import { ReviewsPage } from "./components/ReviewsPage";
import { JiraBoardPage } from "./components/JiraBoardPage";
import { useApp } from "./hooks/useApp";
import { useAppTheme } from "./hooks/useAppTheme";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useAppUpdateToast } from "./hooks/useAppUpdateToast";
import { useTaskNotificationToast } from "./hooks/useTaskNotificationToast";
import { formatNotificationBody } from "./notificationText";
import { planTaskFocus } from "./taskNavigation";
import { openExternal } from "./lib/openExternal";
import { api } from "./api";

type AppView = RailView | "workspace";

/** Static path per top-level view. The store's `currentView` stays the source of
 *  truth; an effect in the layout drives the router to match, so every existing
 *  `setCurrentView` call site keeps working unchanged and `<Outlet/>` renders the
 *  matching leaf. */
const VIEW_TO_PATH: Record<AppView, string> = {
  mission: "/",
  board: "/board",
  workspace: "/workspace",
  settings: "/settings",
  reviews: "/reviews",
  jira: "/jira",
};

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
  app: ReturnType<typeof useApp>;
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
 * The persistent shell + router layout. Owns the single `useApp()` instance and
 * the app-level handlers, drives the router from `currentView`, and renders the
 * overlays (composer / workspace manager / open task) that take over the viewport,
 * falling back to `<Outlet/>` for the routed base view.
 */
function AppLayout() {
  const app = useApp();
  const {
    repos,
    activeWorkspaceId,
    activeWorkspaceRepos,
    setNewTaskRepoIds,
    setNewTaskWorkspaceId,
    tasks,
    selectedRepoId,
    setSelectedRepoId,
    setSelectedTaskId,
    selectedTask,
    counts,
    message,
    setMessage,
    taskToast,
    setTaskToast,
    createTaskOpen,
    setCreateTaskOpen,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    setNewTaskRepoId,
    closeCreateTaskModal,
    currentView,
    setCurrentView,
    setActiveWorkspaceId,
    settings,
    agentProfiles,
  } = app;

  useAppTheme(settings);

  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // Drive the router from the store's currentView (one-directional: the store is
  // the source of truth, the router/Outlet render to match). No URL bar / back
  // buttons in the desktop shell, so no route→store sync is needed.
  useEffect(() => {
    const target = VIEW_TO_PATH[currentView];
    if (pathname !== target) void navigate({ to: target });
  }, [currentView, pathname, navigate]);

  // The workspace manager overlays the routed view, like the New Task composer.
  const [managingWorkspaces, setManagingWorkspaces] = useState(false);

  // Close the composer AND clear the cross-repo selection in one place, so the
  // selection can't leak across opens (it owns the cross-vs-single create routing).
  const closeComposer = useCallback(() => {
    closeCreateTaskModal();
    setNewTaskRepoIds([]);
    setNewTaskWorkspaceId(undefined);
  }, [closeCreateTaskModal, setNewTaskRepoIds, setNewTaskWorkspaceId]);

  useEffect(() => {
    if (!message) return;
    const content = getToastContent(message);
    toast[content.kind](content.title, { description: content.body, duration: 5000 });
    setMessage(null);
  }, [message, setMessage]);

  const openCreateTaskModal = useCallback(() => {
    if (!newTaskAgentProfileId) {
      const defaultAgentProfileId = settings?.defaultAgentProfileId ?? agentProfiles[0]?.id;
      if (defaultAgentProfileId) setNewTaskAgentProfileId(defaultAgentProfileId);
    }
    // Reachable from the icon rail while a task or the workspace manager is open,
    // so dismiss the manager and fall back to the first available repo when none is selected.
    setManagingWorkspaces(false);
    setNewTaskRepoId(selectedRepoId ?? activeWorkspaceRepos[0]?.id ?? repos[0]?.id);
    // Default the composer's scope to the focused workspace board (Workspace mode)
    // only when it can fan out — i.e. it resolves to ≥2 repos. Otherwise Project mode.
    setNewTaskWorkspaceId(activeWorkspaceRepos.length >= 2 ? activeWorkspaceId : undefined);
    setCreateTaskOpen(true);
  }, [
    newTaskAgentProfileId,
    settings?.defaultAgentProfileId,
    agentProfiles,
    setNewTaskAgentProfileId,
    setNewTaskRepoId,
    selectedRepoId,
    activeWorkspaceRepos,
    repos,
    setNewTaskWorkspaceId,
    activeWorkspaceId,
    setCreateTaskOpen,
  ]);

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
    viewport = (
      <CreateTaskComposer
        onClose={closeComposer}
        onSubmit={(e) => {
          e.preventDefault();
          app.createTask();
        }}
        agentProfiles={agentProfiles}
        repos={repos}
        busy={app.busy}
        newTaskTitle={app.newTaskTitle}
        setNewTaskTitle={app.setNewTaskTitle}
        newTaskPrompt={app.newTaskPrompt}
        setNewTaskPrompt={app.setNewTaskPrompt}
        newTaskBranchName={app.newTaskBranchName}
        setNewTaskBranchName={app.setNewTaskBranchName}
        newTaskHasWorktree={app.newTaskHasWorktree}
        setNewTaskHasWorktree={app.setNewTaskHasWorktree}
        suggestedBranchName={app.suggestedBranchName}
        newTaskAgentProfileId={newTaskAgentProfileId}
        setNewTaskAgentProfileId={setNewTaskAgentProfileId}
        newTaskRepoId={app.newTaskRepoId}
        setNewTaskRepoId={setNewTaskRepoId}
        linkedJiraKey={app.pendingJiraLink?.key ?? null}
        workspaces={app.workspaces}
        newTaskWorkspaceId={app.newTaskWorkspaceId}
        setNewTaskWorkspaceId={setNewTaskWorkspaceId}
        selectedRepoIds={app.newTaskRepoIds}
        onSetRepoIds={setNewTaskRepoIds}
      />
    );
  } else if (managingWorkspaces) {
    viewport = (
      <WorkspaceManager
        workspaces={app.workspaces}
        repos={repos}
        busy={app.busy}
        onClose={() => setManagingWorkspaces(false)}
        onCreate={app.createWorkspace}
        onUpdate={app.updateWorkspace}
        onDelete={app.deleteWorkspace}
      />
    );
  } else if (taskOpen && selectedTask) {
    viewport = (
      <div className="nx-viewport-fill" data-testid="dashboard-layout" data-task-workspace="true">
        <TaskWorkspace
          key={selectedTask.id}
          task={selectedTask}
          attention={app.selectedTaskAttention}
          agentProfiles={agentProfiles}
          reviewLoop={app.selectedReviewLoop}
          reviewRuns={app.selectedReviewRuns}
          liveReviewOutput={app.liveReviewOutput}
          githubStatus={app.githubStatus}
          pullRequest={app.selectedPullRequest}
          pullRequestLoading={app.pullRequestLoading}
          creatingPullRequest={app.creatingPullRequest}
          pullRequestBusy={app.pullRequestBusy}
          backLabel={
            currentView === "mission"
              ? "Mission Control"
              : currentView === "workspace"
                ? app.activeWorkspace?.name ?? "Workspace"
                : app.selectedRepo?.name ?? "Board"
          }
          repoName={repos.find((repo) => repo.id === selectedTask.repoId)?.name}
          onClose={() => setSelectedTaskId(undefined)}
          onStopSession={app.stopSession}
          onResumeSession={app.resumeSession}
          onStartSession={app.startSession}
          onStartReview={app.startReview}
          onCreatePullRequest={app.createPullRequest}
          onRefreshPullRequest={app.refreshPullRequest}
          onMergePullRequest={app.mergePullRequest}
          onSetPullRequestReady={app.setPullRequestReady}
          onClosePullRequest={app.closePullRequest}
          onUpdateStatus={app.updateStatus}
          onRenameTask={app.renameTask}
          onDeleteTask={app.requestDeleteTask}
          onSetJiraLink={app.setTaskJiraLink}
          jiraSite={app.jiraStatus?.site}
          onSessionExit={app.onSessionExit}
          onSessionInput={app.onSessionInput}
          busy={app.busy}
          isDeleting={app.deletingTaskIds.has(selectedTask.id)}
        />
      </div>
    );
  } else {
    viewport = <Outlet />;
  }

  const contextValue: AppContextValue = { app, openTask, openCreateTaskModal, appUpdate };

  return (
    <AppContext.Provider value={contextValue}>
      <div
        className={`app-shell nx-app density-${settings?.density ?? "comfortable"} bg-background text-foreground`}
        data-frame={frame}
      >
        <IconRail
          active={railActive}
          needsCount={counts.needsInput}
          onNavigate={handleNavigate}
          onCreateTask={openCreateTaskModal}
          canCreateTask={repos.length > 0}
        />

        {showProjectPanel && (
          <ProjectPanel
            repos={repos}
            workspaces={app.workspaces}
            tasks={tasks}
            taskAttention={app.taskAttention}
            liveLines={app.liveLines}
            selectedRepoId={currentView === "board" ? selectedRepoId : undefined}
            selectedWorkspaceId={currentView === "workspace" ? activeWorkspaceId : undefined}
            onSelectRepo={(id) => {
              setActiveWorkspaceId(undefined);
              setSelectedTaskId(undefined);
              setSelectedRepoId(id);
              setCurrentView("board");
            }}
            onSelectWorkspace={app.openWorkspaceBoard}
            onOpenTask={openTask}
            onAddProject={app.addProject}
            onManageWorkspaces={openManageWorkspaces}
            busy={app.busy}
            loading={app.loading}
          />
        )}

        <div className="nx-viewport">{viewport}</div>

        <Toaster closeButton theme={settings?.theme ?? "system"} />
      </div>
    </AppContext.Provider>
  );
}

function MissionView() {
  const { app, openTask } = useAppContext();
  return (
    <div className="nx-viewport-fill" data-testid="mission-control">
      <MissionControl
        repos={app.repos}
        tasks={app.missionTasks}
        taskAttention={app.taskAttention}
        liveLines={app.liveLines}
        loading={app.loading}
        onOpenTask={openTask}
        onOpenPr={openExternal}
        onRefresh={() => app.refresh()}
      />
    </div>
  );
}

function BoardView() {
  const { app, openTask, openCreateTaskModal } = useAppContext();
  return (
    <div className="nx-viewport-fill" data-testid="dashboard-layout" data-task-workspace="false">
      <Workspace
        selectedRepo={app.selectedRepo}
        visibleTasks={app.visibleTasks}
        selectedTaskId={app.selectedTaskId}
        taskAttention={app.taskAttention}
        liveLines={app.liveLines}
        onSelectTask={openTask}
        onRefresh={app.refresh}
        onCreateTask={openCreateTaskModal}
        onDeleteTask={app.requestDeleteTask}
        onUpdateStatus={app.updateStatus}
        deletingTaskIds={app.deletingTaskIds}
        busy={app.busy}
        loading={app.loading}
      />
    </div>
  );
}

function WorkspaceView() {
  const { app, openTask, openCreateTaskModal } = useAppContext();
  return (
    <div className="nx-viewport-fill" data-testid="workspace-board">
      <Workspace
        selectedRepo={undefined}
        workspaceName={app.activeWorkspace?.name}
        visibleTasks={app.workspaceBoardTasks}
        repoNames={app.repos}
        selectedTaskId={app.selectedTaskId}
        taskAttention={app.taskAttention}
        liveLines={app.liveLines}
        onSelectTask={openTask}
        onRefresh={app.refresh}
        onCreateTask={openCreateTaskModal}
        onDeleteTask={app.requestDeleteTask}
        onUpdateStatus={app.updateStatus}
        deletingTaskIds={app.deletingTaskIds}
        busy={app.busy}
        loading={app.loading}
      />
    </div>
  );
}

function SettingsView() {
  const { app, appUpdate } = useAppContext();
  return (
    <SettingsPage
      settings={app.settings}
      agentProfiles={app.agentProfiles}
      githubStatus={app.githubStatus}
      jiraRestStatus={app.jiraRestStatus}
      jiraDetectedSite={app.jiraStatus?.site}
      appUpdate={appUpdate}
      busy={app.busy}
      onBack={() => app.setCurrentView("mission")}
      onSaveSettings={app.saveAppSettings}
      onSaveAgentProfile={app.saveAgentProfile}
      onSaveJiraToken={app.setJiraApiToken}
      onDisconnectJira={app.clearJiraApiToken}
    />
  );
}

function JiraView() {
  const { app, openTask } = useAppContext();
  return (
    <JiraBoardPage
      status={app.jiraStatus}
      projects={app.jiraProjects}
      tasks={app.tasks}
      onOpenTask={openTask}
      project={app.settings?.jiraBoardProject ?? null}
      filters={{
        myIssues: app.settings?.jiraFilterMyIssues ?? false,
        unresolved: app.settings?.jiraFilterUnresolved ?? true,
        currentSprint: app.settings?.jiraFilterCurrentSprint ?? false,
        statuses: app.settings?.jiraFilterStatuses ?? [],
      }}
      columns={app.jiraColumns}
      loading={app.jiraLoading}
      onChangeConfig={app.setJiraBoardConfig}
      onRefresh={app.refreshJira}
      onTransition={app.transitionJira}
      onOpenItem={app.openJiraItem}
      onCreateTask={app.createTaskFromStory}
      selectedItem={app.selectedJiraItem}
      onCloseItem={() => app.setSelectedJiraItem(null)}
      createOpen={app.createJiraItemOpen}
      onOpenCreate={app.openCreateJiraItem}
      onCloseCreate={app.closeCreateJiraItem}
      onCreateWorkItem={app.createJiraWorkItem}
      agentProfiles={app.agentProfiles}
      selectedAgentProfileId={
        app.newTaskAgentProfileId ?? app.settings?.defaultAgentProfileId ?? app.agentProfiles[0]?.id
      }
      site={app.jiraStatus?.site}
      restConnected={app.jiraRestConnected}
      onListTransitions={api.jiraListTransitions}
      filterableStatuses={
        app.jiraRestConnected
          ? app.jiraProjectStatuses.map((status) => status.name)
          : app.jiraColumns.map((column) => column.statusName)
      }
      onAssign={app.assignJira}
      onComment={app.commentJira}
      onPickAgent={app.setNewTaskAgentProfileId}
      onOpenUrl={openExternal}
    />
  );
}

function ReviewsView() {
  const { app } = useAppContext();
  return (
    <ReviewsPage
      prReviews={app.prReviews}
      selectedPrReview={app.selectedPrReview}
      selectedPrReviewId={app.selectedPrReviewId}
      selectedPrReviewRuns={app.selectedPrReviewRuns}
      agentProfiles={app.agentProfiles}
      defaultReviewerProfileId={app.settings?.defaultAgentProfileId ?? app.agentProfiles[0]?.id}
      creatingReview={app.creatingReview}
      onSelectReview={app.setSelectedPrReviewId}
      onCreateReview={app.createPrReview}
      onRerunReview={app.rerunPrReview}
      onDeleteReview={app.deletePrReview}
      onPostReview={app.postReviewComment}
      onBack={() => app.setCurrentView("mission")}
    />
  );
}

/**
 * Build a fresh router (own route tree + memory history) per mount. Memory history
 * suits a desktop shell with no URL bar; a per-mount instance keeps each
 * `render(<App/>)` in the test suite isolated (a module singleton would leak the
 * current location across tests).
 */
export function createAppRouter() {
  const rootRoute = createRootRoute({ component: AppLayout });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: MissionView }),
    createRoute({ getParentRoute: () => rootRoute, path: "/board", component: BoardView }),
    createRoute({ getParentRoute: () => rootRoute, path: "/workspace", component: WorkspaceView }),
    createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsView }),
    createRoute({ getParentRoute: () => rootRoute, path: "/reviews", component: ReviewsView }),
    createRoute({ getParentRoute: () => rootRoute, path: "/jira", component: JiraView }),
  ]);
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
}

export { RouterProvider };
