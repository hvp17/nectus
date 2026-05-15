import { useState } from "react";

export function useCreateTaskForm(defaultAgentProfileId?: number) {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [newTaskBranchName, setNewTaskBranchName] = useState("");
  const [newTaskHasWorktree, setNewTaskHasWorktree] = useState(false);
  const [newTaskAgentProfileId, setNewTaskAgentProfileId] = useState<number | undefined>(defaultAgentProfileId);

  const resetCreateTaskForm = (agentProfileId = defaultAgentProfileId) => {
    setNewTaskTitle("");
    setNewTaskPrompt("");
    setNewTaskBranchName("");
    setNewTaskHasWorktree(false);
    setNewTaskAgentProfileId(agentProfileId);
  };

  const closeCreateTaskModal = () => {
    setCreateTaskOpen(false);
    resetCreateTaskForm();
  };

  const getGeneratedTaskTitle = () => {
    const title = newTaskTitle.trim();
    if (title) return title;

    const firstPromptLine = newTaskPrompt
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    return firstPromptLine ? firstPromptLine.slice(0, 80) : "Untitled task";
  };

  return {
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
    resetCreateTaskForm,
    closeCreateTaskModal,
    getGeneratedTaskTitle,
  };
}
