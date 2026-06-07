import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
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

function App() {
  const {
    repos,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    activeWorkspaceRepos,
    missionTasks,
    workspaceBoardTasks,
    openWorkspaceBoard,
    newTaskRepoIds,
    setNewTaskRepoIds,
    newTaskWorkspaceId,
    setNewTaskWorkspaceId,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    tasks,
    visibleTasks,
    selectedRepoId,
    setSelectedRepoId,
    selectedTaskId,
    setSelectedTaskId,
    selectedRepo,
    selectedTask,
    selectedReviewLoop,
    selectedReviewRuns,
    liveReviewOutput,
    taskAttention,
    liveLines,
    selectedTaskAttention,
    counts,
    message,
    setMessage,
    taskToast,
    setTaskToast,
    busy,
    deletingTaskIds,
    loading,
    refresh,
    addProject,
    createTaskOpen,
    setCreateTaskOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPrompt,
    setNewTaskPrompt,
    newTaskBranchName,
    setNewTaskBranchName,
    newTaskHasWorktree,
    setNewTaskHasWorktree,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    suggestedBranchName,
    createTask,
    closeCreateTaskModal,
    updateStatus,
    requestDeleteTask,
    startSession,
    stopSession,
    resumeSession,
    createPullRequest,
    githubStatus,
    selectedPullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
    jiraStatus,
    jiraRestStatus,
    jiraRestConnected,
    jiraProjects,
    jiraProjectStatuses,
    jiraColumns,
    jiraLoading,
    refreshJira,
    transitionJira,
    assignJira,
    commentJira,
    setJiraApiToken,
    clearJiraApiToken,
    setJiraBoardConfig,
    selectedJiraItem,
    setSelectedJiraItem,
    openJiraItem,
    createJiraItemOpen,
    openCreateJiraItem,
    closeCreateJiraItem,
    createJiraWorkItem,
    createTaskFromStory,
    setTaskJiraLink,
    newTaskRepoId,
    setNewTaskRepoId,
    pendingJiraLink,
    startReview,
    onSessionExit,
    onSessionInput,
    agentProfiles,
    settings,
    currentView,
    setCurrentView,
    saveAppSettings,
    saveAgentProfile,
    prReviews,
    selectedPrReviewId,
    setSelectedPrReviewId,
    selectedPrReview,
    selectedPrReviewRuns,
    creatingReview,
    createPrReview,
    rerunPrReview,
    deletePrReview,
    postReviewComment,
  } = useApp();

  useAppTheme(settings);

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
    toast[content.kind](content.title, {
      description: content.body,
      duration: 5000,
    });
    setMessage(null);
  }, [message, setMessage]);

  const openCreateTaskModal = () => {
    if (!newTaskAgentProfileId) {
      const defaultAgentProfileId = settings?.defaultAgentProfileId ?? agentProfiles[0]?.id;
      if (defaultAgentProfileId) {
        setNewTaskAgentProfileId(defaultAgentProfileId);
      }
    }
    // Reachable from the icon rail while a task or the workspace manager is open,
    // so dismiss the manager and fall back to the first available repo when none is selected.
    setManagingWorkspaces(false);
    setNewTaskRepoId(selectedRepoId ?? activeWorkspaceRepos[0]?.id ?? repos[0]?.id);
    // Default the composer's scope to the focused workspace board (Workspace mode)
    // only when it can fan out — i.e. it resolves to ≥2 repos. Otherwise Project mode.
    setNewTaskWorkspaceId(activeWorkspaceRepos.length >= 2 ? activeWorkspaceId : undefined);
    setCreateTaskOpen(true);
  };

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
  const navigate = (view: RailView) => {
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
  // The New Task composer is a focused inline view reached from "New Task".
  const composing = createTaskOpen;
  // The merged navigator is persistent on the work views (Mission Control + both
  // boards) AND while a task is open (task details keep the projects/workspaces
  // sidebar), and hidden only when the composer / workspace manager takes over.
  const showProjectPanel =
    (currentView === "mission" || currentView === "board" || currentView === "workspace") &&
    !composing &&
    !managingWorkspaces;
  // The workspace board is panel-driven, not a rail destination; map it to "board".
  const railActive: RailView = currentView === "workspace" ? "board" : currentView;
  const frame = showProjectPanel ? "railp" : "rail";

  return (
    <TooltipProvider>
      <div
        className={`app-shell nx-app density-${settings?.density ?? "comfortable"} bg-background text-foreground`}
        data-frame={frame}
      >
        <IconRail
          active={railActive}
          needsCount={counts.needsInput}
          onNavigate={navigate}
          onCreateTask={openCreateTaskModal}
          canCreateTask={repos.length > 0}
        />

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

        <div className="nx-viewport">
          {composing ? (
            <CreateTaskComposer
              onClose={closeComposer}
              onSubmit={(e) => {
                e.preventDefault();
                createTask();
              }}
              agentProfiles={agentProfiles}
              repos={repos}
              busy={busy}
              newTaskTitle={newTaskTitle}
              setNewTaskTitle={setNewTaskTitle}
              newTaskPrompt={newTaskPrompt}
              setNewTaskPrompt={setNewTaskPrompt}
              newTaskBranchName={newTaskBranchName}
              setNewTaskBranchName={setNewTaskBranchName}
              newTaskHasWorktree={newTaskHasWorktree}
              setNewTaskHasWorktree={setNewTaskHasWorktree}
              suggestedBranchName={suggestedBranchName}
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
          ) : managingWorkspaces ? (
            <WorkspaceManager
              workspaces={workspaces}
              repos={repos}
              busy={busy}
              onClose={() => setManagingWorkspaces(false)}
              onCreate={createWorkspace}
              onUpdate={updateWorkspace}
              onDelete={deleteWorkspace}
            />
          ) : currentView === "settings" ? (
            <SettingsPage
              settings={settings}
              agentProfiles={agentProfiles}
              githubStatus={githubStatus}
              jiraRestStatus={jiraRestStatus}
              jiraDetectedSite={jiraStatus?.site}
              appUpdate={appUpdate}
              busy={busy}
              onBack={() => setCurrentView("mission")}
              onSaveSettings={saveAppSettings}
              onSaveAgentProfile={saveAgentProfile}
              onSaveJiraToken={setJiraApiToken}
              onDisconnectJira={clearJiraApiToken}
            />
          ) : currentView === "jira" ? (
            <JiraBoardPage
              status={jiraStatus}
              projects={jiraProjects}
              tasks={tasks}
              onOpenTask={openTask}
              project={settings?.jiraBoardProject ?? null}
              filters={{
                myIssues: settings?.jiraFilterMyIssues ?? false,
                unresolved: settings?.jiraFilterUnresolved ?? true,
                currentSprint: settings?.jiraFilterCurrentSprint ?? false,
                statuses: settings?.jiraFilterStatuses ?? [],
              }}
              columns={jiraColumns}
              loading={jiraLoading}
              onChangeConfig={setJiraBoardConfig}
              onRefresh={refreshJira}
              onTransition={transitionJira}
              onOpenItem={openJiraItem}
              onCreateTask={createTaskFromStory}
              selectedItem={selectedJiraItem}
              onCloseItem={() => setSelectedJiraItem(null)}
              createOpen={createJiraItemOpen}
              onOpenCreate={openCreateJiraItem}
              onCloseCreate={closeCreateJiraItem}
              onCreateWorkItem={createJiraWorkItem}
              agentProfiles={agentProfiles}
              selectedAgentProfileId={
                newTaskAgentProfileId ?? settings?.defaultAgentProfileId ?? agentProfiles[0]?.id
              }
              site={jiraStatus?.site}
              restConnected={jiraRestConnected}
              onListTransitions={api.jiraListTransitions}
              filterableStatuses={
                jiraRestConnected
                  ? jiraProjectStatuses.map((status) => status.name)
                  : jiraColumns.map((column) => column.statusName)
              }
              onAssign={assignJira}
              onComment={commentJira}
              onPickAgent={setNewTaskAgentProfileId}
              onOpenUrl={openExternal}
            />
          ) : currentView === "reviews" ? (
            <ReviewsPage
              prReviews={prReviews}
              selectedPrReview={selectedPrReview}
              selectedPrReviewId={selectedPrReviewId}
              selectedPrReviewRuns={selectedPrReviewRuns}
              agentProfiles={agentProfiles}
              defaultReviewerProfileId={settings?.defaultAgentProfileId ?? agentProfiles[0]?.id}
              creatingReview={creatingReview}
              onSelectReview={setSelectedPrReviewId}
              onCreateReview={createPrReview}
              onRerunReview={rerunPrReview}
              onDeleteReview={deletePrReview}
              onPostReview={postReviewComment}
              onBack={() => setCurrentView("mission")}
            />
          ) : taskOpen && selectedTask ? (
            <div
              className="nx-viewport-fill"
              data-testid="dashboard-layout"
              data-task-workspace="true"
            >
              <TaskWorkspace
                key={selectedTask.id}
                task={selectedTask}
                attention={selectedTaskAttention}
                agentProfiles={agentProfiles}
                reviewLoop={selectedReviewLoop}
                reviewRuns={selectedReviewRuns}
                liveReviewOutput={liveReviewOutput}
                githubStatus={githubStatus}
                pullRequest={selectedPullRequest}
                pullRequestLoading={pullRequestLoading}
                creatingPullRequest={creatingPullRequest}
                pullRequestBusy={pullRequestBusy}
                backLabel={currentView === "mission" ? "Mission Control" : currentView === "workspace" ? (activeWorkspace?.name ?? "Workspace") : selectedRepo?.name ?? "Board"}
                repoName={repos.find((repo) => repo.id === selectedTask.repoId)?.name}
                onClose={() => {
                  setSelectedTaskId(undefined);
                }}
                onStopSession={stopSession}
                onResumeSession={resumeSession}
                onStartSession={startSession}
                onStartReview={startReview}
                onCreatePullRequest={createPullRequest}
                onRefreshPullRequest={refreshPullRequest}
                onMergePullRequest={mergePullRequest}
                onSetPullRequestReady={setPullRequestReady}
                onClosePullRequest={closePullRequest}
                onUpdateStatus={updateStatus}
                onDeleteTask={requestDeleteTask}
                onSetJiraLink={setTaskJiraLink}
                jiraSite={jiraStatus?.site}
                onSessionExit={onSessionExit}
                onSessionInput={onSessionInput}
                busy={busy}
                isDeleting={deletingTaskIds.has(selectedTask.id)}
              />
            </div>
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
            <div className="nx-viewport-fill" data-testid="mission-control">
              <MissionControl
                repos={repos}
                tasks={missionTasks}
                taskAttention={taskAttention}
                liveLines={liveLines}
                loading={loading}
                onOpenTask={openTask}
                onOpenPr={openExternal}
                onRefresh={() => refresh()}
              />
            </div>
          ) : (
            <div className="nx-viewport-fill" data-testid="dashboard-layout" data-task-workspace="false">
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
                loading={loading}
              />
            </div>
          )}
        </div>

        <Toaster closeButton theme={settings?.theme ?? "system"} />
      </div>
    </TooltipProvider>
  );
}

export default App;
