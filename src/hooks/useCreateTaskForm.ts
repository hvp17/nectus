import { useState } from "react";

export function createBranchIdentifier() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `task-${globalThis.crypto.randomUUID()}`;
  }

  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSuggestedWorktreeBranchName(defaultBranchPrefix: string | null | undefined, branchIdentifier: string) {
  return `${defaultBranchPrefix?.trim() ?? ""}${branchIdentifier}`;
}

export function resolveWorktreeBranchName(
  branchName: string,
  defaultBranchPrefix?: string | null,
  branchIdentifier = createBranchIdentifier(),
) {
  const trimmedBranchName = branchName.trim();
  const trimmedDefaultPrefix = defaultBranchPrefix?.trim() ?? "";

  if (trimmedBranchName && trimmedBranchName !== trimmedDefaultPrefix) {
    return trimmedBranchName;
  }

  return getSuggestedWorktreeBranchName(trimmedDefaultPrefix, branchIdentifier);
}

export function useCreateTaskForm(defaultAgentProfileId?: number) {
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [newTaskBranchName, setNewTaskBranchName] = useState("");
  const [newTaskBranchIdentifier, setNewTaskBranchIdentifier] = useState(() => createBranchIdentifier());
  const [newTaskHasWorktree, setNewTaskHasWorktree] = useState(false);
  const [newTaskAgentProfileId, setNewTaskAgentProfileId] = useState<number | undefined>(defaultAgentProfileId);

  const resetCreateTaskForm = (agentProfileId = defaultAgentProfileId) => {
    setNewTaskTitle("");
    setNewTaskPrompt("");
    setNewTaskBranchName("");
    setNewTaskBranchIdentifier(createBranchIdentifier());
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

  const getSuggestedBranchName = (defaultBranchPrefix?: string | null) =>
    getSuggestedWorktreeBranchName(defaultBranchPrefix, newTaskBranchIdentifier);

  const resolveBranchName = (branchName: string, defaultBranchPrefix?: string | null) =>
    resolveWorktreeBranchName(branchName, defaultBranchPrefix, newTaskBranchIdentifier);

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
    getSuggestedBranchName,
    resolveWorktreeBranchName: resolveBranchName,
  };
}
