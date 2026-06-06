import type { Repo, TaskSummary } from "../types";

export const appRepo: Repo = {
  id: 7,
  name: "nectus-desktop",
  path: "/tmp/nectus-desktop",
  defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
  createdAt: "2026-05-14T00:00:00.000Z",
};

export function appTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 21,
    repoId: appRepo.id,
    workspaceId: null,
    title: "Test task",
    prompt: null,
    status: "planned",
    taskRepos: [],
    prUrl: null,
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: false,
    branchName: null,
    worktreePath: null,
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}
