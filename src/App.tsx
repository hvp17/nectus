import { type CSSProperties, useEffect } from "react";
import { toast } from "sonner";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { TaskWorkspace } from "./components/TaskWorkspace";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { SettingsPage } from "./components/SettingsPage";
import { ReviewsPage } from "./components/ReviewsPage";
import { JiraBoardPage } from "./components/JiraBoardPage";
import { JiraWorkItemDialog } from "./components/JiraWorkItemDialog";
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

  // Focus a task in the dashboard from anywhere (sidebar, JIRA board card).
  const openTask = (taskId: number) => {
    const task = tasks.find((item) => item.id === taskId);
    setCurrentView("dashboard");
    if (task) {
      setSelectedRepoId(task.repoId);
    }
    setSelectedTaskId(taskId);
  };

  return (
    <TooltipProvider>
      <SidebarProvider
        className={`app-shell bg-background text-foreground density-${settings?.density ?? "comfortable"}`}
        style={{ "--sidebar-width": "260px" } as CSSProperties}
      >
        <Sidebar
          repos={repos}
          selectedRepoId={selectedRepoId}
          selectedTaskId={selectedTaskId}
          tasks={tasks}
          taskAttention={taskAttention}
          onSelectRepo={(id) => {
            setCurrentView("dashboard");
            setSelectedRepoId(id);
            setSelectedTaskId(undefined);
          }}
          onOpenTask={openTask}
          onCreateTaskInRepo={(repoId) => {
            setCurrentView("dashboard");
            setSelectedRepoId(repoId);
            setSelectedTaskId(undefined);
            openCreateTaskModal();
          }}
          onAddProject={addProject}
          onOpenSettings={() => {
            setCurrentView("settings");
            setSelectedTaskId(undefined);
          }}
          onOpenReviews={() => {
            setCurrentView("reviews");
            setSelectedTaskId(undefined);
          }}
          onOpenJira={() => {
            setCurrentView("jira");
            setSelectedTaskId(undefined);
          }}
          onStopSession={stopSession}
          settingsActive={currentView === "settings"}
          reviewsActive={currentView === "reviews"}
          jiraActive={currentView === "jira"}
          busy={busy}
          loading={loading}
        />

        <SidebarInset className="content-shell">
          {currentView === "settings" ? (
            <SettingsPage
              settings={settings}
              agentProfiles={agentProfiles}
              githubStatus={githubStatus}
              busy={busy}
              onBack={() => setCurrentView("dashboard")}
              onSaveSettings={saveAppSettings}
              onSaveAgentProfile={saveAgentProfile}
            />
          ) : currentView === "jira" ? (
            <>
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
              />
              <JiraWorkItemDialog
                item={selectedJiraItem}
                statusOptions={jiraColumns.map((column) => column.statusName)}
                site={jiraStatus?.site}
                onClose={() => setSelectedJiraItem(null)}
                onTransition={(item, statusName) => {
                  transitionJira(item, statusName);
                  setSelectedJiraItem(null);
                }}
                onAssign={assignJira}
                onComment={commentJira}
                onCreateTask={createTaskFromStory}
                onOpenUrl={(url) => void api.openExternalUrl(url)}
              />
            </>
          ) : currentView === "reviews" ? (
            <ReviewsPage
              prReviews={prReviews}
              selectedPrReview={selectedPrReview}
              selectedPrReviewId={selectedPrReviewId}
              agentProfiles={agentProfiles}
              defaultReviewerProfileId={settings?.defaultAgentProfileId ?? agentProfiles[0]?.id}
              creatingReview={creatingReview}
              onSelectReview={setSelectedPrReviewId}
              onCreateReview={createPrReview}
              onRerunReview={rerunPrReview}
              onDeleteReview={deletePrReview}
              onBack={() => setCurrentView("dashboard")}
            />
          ) : (
            <div
              className="dashboard-layout"
              data-testid="dashboard-layout"
              data-task-workspace={selectedTask ? "true" : "false"}
            >
              {selectedTask ? (
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
              ) : (
                <div className="workspace-frame">
                  <Workspace
                    selectedRepo={selectedRepo}
                    visibleTasks={visibleTasks}
                    selectedTaskId={selectedTaskId}
                    taskAttention={taskAttention}
                    onSelectTask={setSelectedTaskId}
                    onRefresh={refresh}
                    onCreateTask={openCreateTaskModal}
                    onDeleteTask={requestDeleteTask}
                    onUpdateStatus={updateStatus}
                    deletingTaskIds={deletingTaskIds}
                    counts={counts}
                    busy={busy}
                    loading={loading}
                  />
                </div>
              )}
            </div>
          )}

          <Toaster closeButton theme={settings?.theme ?? "system"} />
        </SidebarInset>

        {createTaskOpen && (
          <CreateTaskModal
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
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
