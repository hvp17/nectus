// Branch-name helpers + the JIRA-link type for the New Task composer. The composer
// draft itself now lives in the Zustand `composerSlice`; `useComposer` consumes
// these helpers. (The former `useCreateTaskForm` hook was retired with that move.)

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

export interface PendingJiraLink {
  key: string;
  summary: string;
  url: string | null;
}
