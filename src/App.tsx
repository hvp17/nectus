import { useEffect } from "react";
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

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, 2500);

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
          }}
          onAddProject={addProject}
          onOpenSettings={() => {
            setCurrentView("settings");
            setSelectedTaskId(undefined);
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
          ) : selectedTask ? (
            <TaskDetailDrawer
              task={selectedTask}
              onClose={() => setSelectedTaskId(undefined)}
              onStopSession={stopSession}
              onResumeSession={resumeSession}
              onStartSession={startSession}
              onUpdateStatus={updateStatus}
              onSessionExit={onSessionExit}
            />
          ) : (
            <Workspace
              selectedRepo={selectedRepo}
              visibleTasks={visibleTasks}
              selectedTaskId={selectedTaskId}
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
