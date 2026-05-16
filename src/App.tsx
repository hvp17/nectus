import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { SettingsPage } from "./components/SettingsPage";
import { useApp } from "./hooks/useApp";
import { useAppTheme } from "./hooks/useAppTheme";

function getToastContent(message: string) {
  const separator = message.indexOf(": ");
  if (separator > 0) {
    return {
      title: message.slice(0, separator),
      body: message.slice(separator + 2),
      kind: "success" as const,
    };
  }

  return {
    title: "Nectus",
    body: message,
    kind: "info" as const,
  };
}

function App() {
  const {
    repos,
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
    startPairLoop,
    stopPairLoop,
    onSessionExit,
    onSessionInput,
    agentProfiles,
    settings,
    currentView,
    setCurrentView,
    saveAppSettings,
    saveAgentProfile,
  } = useApp();
  const [detailExpanded, setDetailExpanded] = useState(false);

  useAppTheme(settings);

  useEffect(() => {
    if (!selectedTask) {
      setDetailExpanded(false);
    }
  }, [selectedTask]);

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
      <main className={`app-shell bg-background text-foreground density-${settings?.density ?? "comfortable"}`}>
        <Sidebar
          repos={repos}
          selectedRepoId={selectedRepoId}
          onSelectRepo={(id) => {
            setCurrentView("dashboard");
            setSelectedRepoId(id);
            setSelectedTaskId(undefined);
            setDetailExpanded(false);
          }}
          onAddProject={addProject}
          onOpenSettings={() => {
            setCurrentView("settings");
            setSelectedTaskId(undefined);
            setDetailExpanded(false);
          }}
          settingsActive={currentView === "settings"}
          busy={busy}
          loading={loading}
        />

        <div className="content-shell">
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
              data-detail-open={selectedTask ? "true" : "false"}
              data-detail-expanded={detailExpanded ? "true" : "false"}
            >
              <div className="workspace-frame" aria-hidden={detailExpanded ? "true" : undefined}>
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

              {selectedTask && (
                <TaskDetailDrawer
                  task={selectedTask}
                  attention={selectedTaskAttention}
                  agentProfiles={agentProfiles}
                  reviewLoop={selectedReviewLoop}
                  reviewRuns={selectedReviewRuns}
                  isExpanded={detailExpanded}
                  onToggleExpanded={() => setDetailExpanded((current) => !current)}
                  onClose={() => {
                    setDetailExpanded(false);
                    setSelectedTaskId(undefined);
                  }}
                  onStopSession={stopSession}
                  onResumeSession={resumeSession}
                  onStartSession={startSession}
                  onStartPairLoop={startPairLoop}
                  onStopPairLoop={stopPairLoop}
                  onUpdateStatus={updateStatus}
                  onSessionExit={onSessionExit}
                  onSessionInput={onSessionInput}
                />
              )}
            </div>
          )}

          <Toaster closeButton theme={settings?.theme ?? "system"} />
        </div>

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
      </main>
    </TooltipProvider>
  );
}

export default App;
