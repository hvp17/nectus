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
import { useApp } from "./hooks/useApp";
import { useAppTheme } from "./hooks/useAppTheme";
import { formatNotificationBody } from "./notificationText";

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
    createTask,
    closeCreateTaskModal,
    updateStatus,
    requestDeleteTask,
    startSession,
    stopSession,
    resumeSession,
    startReview,
    onSessionExit,
    onSessionInput,
    agentProfiles,
    settings,
    currentView,
    setCurrentView,
    saveAppSettings,
    saveAgentProfile,
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
          onOpenTask={(taskId) => {
            const task = tasks.find((item) => item.id === taskId);
            setCurrentView("dashboard");
            if (task) {
              setSelectedRepoId(task.repoId);
            }
            setSelectedTaskId(taskId);
          }}
          onAddProject={addProject}
          onOpenSettings={() => {
            setCurrentView("settings");
            setSelectedTaskId(undefined);
          }}
          onStopSession={stopSession}
          settingsActive={currentView === "settings"}
          busy={busy}
          loading={loading}
        />

        <SidebarInset className="content-shell">
          {currentView === "settings" ? (
            <SettingsPage
              settings={settings}
              agentProfiles={agentProfiles}
              busy={busy}
              onBack={() => setCurrentView("dashboard")}
              onSaveSettings={saveAppSettings}
              onSaveAgentProfile={saveAgentProfile}
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
                  onClose={() => {
                    setSelectedTaskId(undefined);
                  }}
                  onStopSession={stopSession}
                  onResumeSession={resumeSession}
                  onStartSession={startSession}
                  onStartReview={startReview}
                  onUpdateStatus={updateStatus}
                  onSessionExit={onSessionExit}
                  onSessionInput={onSessionInput}
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
                    onCreateTask={() => {
                      if (!newTaskAgentProfileId) {
                        const defaultAgentProfileId = settings?.defaultAgentProfileId ?? agentProfiles[0]?.id;
                        if (defaultAgentProfileId) {
                          setNewTaskAgentProfileId(defaultAgentProfileId);
                        }
                      }
                      setCreateTaskOpen(true);
                    }}
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
            busy={busy}
            newTaskTitle={newTaskTitle}
            setNewTaskTitle={setNewTaskTitle}
            newTaskPrompt={newTaskPrompt}
            setNewTaskPrompt={setNewTaskPrompt}
            newTaskBranchName={newTaskBranchName}
            setNewTaskBranchName={setNewTaskBranchName}
            newTaskHasWorktree={newTaskHasWorktree}
            setNewTaskHasWorktree={setNewTaskHasWorktree}
            defaultBranchPrefix={settings?.defaultBranchPrefix}
            newTaskAgentProfileId={newTaskAgentProfileId}
            setNewTaskAgentProfileId={setNewTaskAgentProfileId}
          />
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
