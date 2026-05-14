import { TooltipProvider } from "./components/ui/tooltip";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { useApp } from "./hooks/useApp";

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
  } = useApp();

  return (
    <TooltipProvider>
      <main className={`app-shell bg-background text-foreground ${selectedTask ? "detail-open" : ""}`}>
        <Sidebar
          repos={repos}
          selectedRepoId={selectedRepoId}
          onSelectRepo={(id) => {
            setSelectedRepoId(id);
            setSelectedTaskId(undefined);
          }}
          onAddProject={addProject}
          busy={busy}
          loading={loading}
        />

        <div className="relative flex flex-col flex-1 min-w-0 overflow-hidden">
          <Workspace
            selectedRepo={selectedRepo}
            visibleTasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onRefresh={refresh}
            onCreateTask={() => setCreateTaskOpen(true)}
            onDeleteTask={requestDeleteTask}
            counts={counts}
            busy={busy}
            loading={loading}
            confirmingDeleteTaskId={confirmingDeleteTaskId}
          />

          {message && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
              <Alert className="shadow-2xl border-primary/20 bg-background/95 backdrop-blur">
                <AlertDescription className="font-medium">{message}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>

        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTaskId(undefined)}
          onStopSession={stopSession}
          onResumeSession={resumeSession}
          onStartSession={startSession}
          onUpdateStatus={updateStatus}
          onSessionExit={onSessionExit}
        />

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
            newTaskAgentProfileId={newTaskAgentProfileId}
            setNewTaskAgentProfileId={setNewTaskAgentProfileId}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

export default App;
