import { useEffect } from "react";
import { TooltipProvider } from "./components/ui/tooltip";
import { CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { TaskDetailDrawer } from "./components/TaskDetailDrawer";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { useApp } from "./hooks/useApp";

function getToastContent(message: string) {
  const separator = message.indexOf(": ");
  if (separator > 0) {
    return {
      title: message.slice(0, separator),
      body: message.slice(separator + 2),
      icon: "success" as const,
    };
  }

  return {
    title: "Nectus",
    body: message,
    icon: "info" as const,
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
  } = useApp();

  useEffect(() => {
    if (!message) return;

    const timeout = window.setTimeout(() => {
      setMessage(null);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [message, setMessage]);

  return (
    <TooltipProvider>
      <main className="app-shell bg-background text-foreground">
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

        <div className="content-shell">
          {selectedTask ? (
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
              onCreateTask={() => setCreateTaskOpen(true)}
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
            newTaskAgentProfileId={newTaskAgentProfileId}
            setNewTaskAgentProfileId={setNewTaskAgentProfileId}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

function ToastNotification({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const toast = getToastContent(message);
  const Icon = toast.icon === "success" ? CheckCircle2Icon : InfoIcon;

  return (
    <div className="toast-viewport animate-in fade-in slide-in-from-top-3 duration-300">
      <Alert className="nectus-toast">
        <Icon />
        <AlertTitle>{toast.title}</AlertTitle>
        <AlertDescription>{toast.body}</AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

export default App;
