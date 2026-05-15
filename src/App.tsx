import { useEffect, useState } from "react";
import { TooltipProvider } from "./components/ui/tooltip";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { SettingsPage } from "./components/SettingsPage";
import { ToastNotification } from "./ToastNotification";
import { useApp } from "./hooks/useApp";
import { useAppTheme } from "./hooks/useAppTheme";

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
    taskAttention,
    selectedTaskAttention,
    counts,
    message,
    setMessage,
    busy,
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
    confirmingDeleteTaskId,
    startSession,
    stopSession,
    resumeSession,
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

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, 5000);

    return () => window.clearTimeout(timeout);
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
                  counts={counts}
                  busy={busy}
                  loading={loading}
                  confirmingDeleteTaskId={confirmingDeleteTaskId}
                />
              </div>

              {selectedTask && (
                <TaskDetailDrawer
                  task={selectedTask}
                  attention={selectedTaskAttention}
                  isExpanded={detailExpanded}
                  onToggleExpanded={() => setDetailExpanded((current) => !current)}
                  onClose={() => {
                    setDetailExpanded(false);
                    setSelectedTaskId(undefined);
                  }}
                  onStopSession={stopSession}
                  onResumeSession={resumeSession}
                  onStartSession={startSession}
                  onUpdateStatus={updateStatus}
                  onSessionExit={onSessionExit}
                  onSessionInput={onSessionInput}
                />
              )}
            </div>
          )}

          {message && <ToastNotification message={message} onDismiss={() => setMessage(null)} />}
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
