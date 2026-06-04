import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { IconRail, type RailView } from "./components/IconRail";
import { ProjectPanel } from "./components/ProjectPanel";
import { MissionControl } from "./components/MissionControl";
import { Workspace } from "./components/Workspace";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { CreateTaskComposer } from "./components/CreateTaskModal";
import { SettingsPage } from "./components/SettingsPage";
import { ReviewsPage } from "./components/ReviewsPage";
import { JiraBoardPage } from "./components/JiraBoardPage";
import { useApp } from "./hooks/useApp";
import { useAppTheme } from "./hooks/useAppTheme";
import { formatNotificationBody } from "./notificationText";
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
    taskAttention,
    selectedTaskAttention,
    counts,
    message,
    setMessage,
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
    refreshPullRequest,
    jiraStatus,
    jiraProjects,
    jiraColumns,
    jiraLoading,
    refreshJira,
    transitionJira,
    assignJira,
    commentJira,
    setJiraBoardConfig,
    selectedJiraItem,
    setSelectedJiraItem,
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
  } = useApp();

  useAppTheme(settings);

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
    setNewTaskRepoId(selectedRepoId);
    setCreateTaskOpen(true);
  };

  // Focus a task into the workspace from anywhere (Mission Control, board, JIRA card).
  const openTask = (taskId: number) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) {
      setSelectedRepoId(task.repoId);
    }
    setSelectedTaskId(taskId);
    setCurrentView((view) => (view === "mission" || view === "board" ? view : "board"));
  };

  // Top-level rail navigation. Board needs a selected project to show its kanban.
  const navigate = (view: RailView) => {
    // The composer (and task workspace) overlay the routed view, so leaving via
    // the rail must dismiss them.
    if (createTaskOpen) closeCreateTaskModal();
    setSelectedTaskId(undefined);
    if (view === "board" && selectedRepoId === undefined && repos[0]) {
      setSelectedRepoId(repos[0].id);
    }
    setCurrentView(view);
  };

  const openExternalUrl = (url: string) => {
    void api.openExternalUrl(url);
  };

  // A task is opened on top of Mission Control or the board, never the secondary views.
  const taskOpen = Boolean(selectedTask) && (currentView === "mission" || currentView === "board");
  // The New Task composer is a focused inline view reached from "New Task".
  const composing = createTaskOpen;
  const showProjectPanel = currentView === "board" && !taskOpen && !composing;
  const railActive: RailView = currentView;
  const frame = showProjectPanel ? "railp" : "rail";

  return (
    <TooltipProvider>
      <div
        className={`app-shell nx-app density-${settings?.density ?? "comfortable"} bg-background text-foreground`}
        data-frame={frame}
      >
        <IconRail active={railActive} needsCount={counts.needsInput} onNavigate={navigate} />

        {showProjectPanel && (
          <ProjectPanel
            repos={repos}
            tasks={tasks}
            taskAttention={taskAttention}
            selectedRepoId={selectedRepoId}
            onSelectRepo={(id) => {
              setCurrentView("board");
              setSelectedRepoId(id);
              setSelectedTaskId(undefined);
            }}
            onAddProject={addProject}
            busy={busy}
            loading={loading}
          />
        )}

        <div className="nx-viewport">
          {composing ? (
            <CreateTaskComposer
              onClose={closeCreateTaskModal}
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
            />
          ) : currentView === "settings" ? (
            <SettingsPage
              settings={settings}
              agentProfiles={agentProfiles}
              githubStatus={githubStatus}
              busy={busy}
              onBack={() => setCurrentView("mission")}
              onSaveSettings={saveAppSettings}
              onSaveAgentProfile={saveAgentProfile}
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
              }}
              columns={jiraColumns}
              loading={jiraLoading}
              onChangeConfig={setJiraBoardConfig}
              onRefresh={refreshJira}
              onTransition={transitionJira}
              onOpenItem={setSelectedJiraItem}
              onCreateTask={createTaskFromStory}
              selectedItem={selectedJiraItem}
              onCloseItem={() => setSelectedJiraItem(null)}
              agentProfiles={agentProfiles}
              selectedAgentProfileId={
                newTaskAgentProfileId ?? settings?.defaultAgentProfileId ?? agentProfiles[0]?.id
              }
              site={jiraStatus?.site}
              onAssign={assignJira}
              onComment={commentJira}
              onPickAgent={setNewTaskAgentProfileId}
              onOpenUrl={openExternalUrl}
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
              onBack={() => setCurrentView("mission")}
            />
          ) : taskOpen && selectedTask ? (
            <div
              className="nx-viewport-fill"
              data-testid="dashboard-layout"
              data-task-workspace="true"
            >
              <TaskWorkspace
                task={selectedTask}
                attention={selectedTaskAttention}
                agentProfiles={agentProfiles}
                reviewLoop={selectedReviewLoop}
                reviewRuns={selectedReviewRuns}
                githubStatus={githubStatus}
                pullRequest={selectedPullRequest}
                pullRequestLoading={pullRequestLoading}
                creatingPullRequest={creatingPullRequest}
                backLabel={currentView === "mission" ? "Mission Control" : selectedRepo?.name ?? "Board"}
                onClose={() => {
                  setSelectedTaskId(undefined);
                }}
                onStopSession={stopSession}
                onResumeSession={resumeSession}
                onStartSession={startSession}
                onStartReview={startReview}
                onCreatePullRequest={createPullRequest}
                onRefreshPullRequest={refreshPullRequest}
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
          ) : currentView === "mission" ? (
            <div className="nx-viewport-fill" data-testid="mission-control">
              <MissionControl
                repos={repos}
                tasks={tasks}
                taskAttention={taskAttention}
                loading={loading}
                onOpenTask={openTask}
                onOpenPr={openExternalUrl}
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
