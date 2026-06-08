import { describe, expect, it } from "vitest";
import { buildSidebarAgents, dominantState } from "./sidebarAgents";
import type { Repo, TaskSummary, Workspace } from "../types";

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 1, repoId: 1, workspaceId: null, title: "T", prompt: null, status: "planned",
    taskRepos: [], prUrl: null, agentProfileId: 1, agentName: "Codex", agentKind: "codex",
    hasWorktree: false, branchName: null, worktreePath: null, isDirty: false,
    activeSessionId: null, lastSessionId: null, lastSessionAgent: null, lastSessionCwd: null,
    lastSessionLabel: null, createdAt: "2026-06-07T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}
const repos: Repo[] = [
  { id: 1, name: "alpha", path: "/a", defaultWorktreeRoot: "/a-wt", createdAt: "2026-06-07T00:00:00.000Z", collapsed: false },
  { id: 2, name: "beta", path: "/b", defaultWorktreeRoot: "/b-wt", createdAt: "2026-06-07T00:00:00.000Z", collapsed: false },
];
const workspaces: Workspace[] = [
  { id: 10, name: "Core", repoIds: [1, 2], createdAt: "x", updatedAt: "x", collapsed: false },
];

describe("buildSidebarAgents", () => {
  it("buckets only active agents by repo and unions them by workspace", () => {
    const tasks = [
      task({ id: 1, repoId: 1, activeSessionId: "s1" }), // running
      task({ id: 2, repoId: 2, status: "review" }),       // review
      task({ id: 3, repoId: 1, status: "done" }),         // terminal — excluded
    ];
    const { byRepo, byWorkspace } = buildSidebarAgents(tasks, [], repos, workspaces, {}, 0);

    expect(byRepo.get(1)?.map((r) => r.task.id)).toEqual([1]);
    expect(byRepo.get(2)?.map((r) => r.task.id)).toEqual([2]);
    expect(byWorkspace.get(10)?.map((r) => r.task.id).sort()).toEqual([1, 2]);
  });

  it("dominantState returns the most urgent active state present, else undefined", () => {
    const tasks = [task({ id: 1, repoId: 1, status: "review" }), task({ id: 2, repoId: 1, activeSessionId: "s" })];
    const { byRepo } = buildSidebarAgents(tasks, [], repos, workspaces, {}, 0);
    expect(dominantState(byRepo.get(1) ?? [])).toBe("running"); // running outranks review
    expect(dominantState([])).toBeUndefined();
  });
});
