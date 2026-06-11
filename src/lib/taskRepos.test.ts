import { describe, expect, it } from "vitest";
import { isCrossRepoTask, taskRepoName, taskRepoPrUrl, taskRepoWorktreePath } from "./taskRepos";
import type { TaskSummary } from "../types";

const task = {
  id: 1,
  repoId: 10,
  prUrl: "https://github.com/a/x/pull/1",
  worktreePath: "/wt/x",
  taskRepos: [
    {
      repoId: 10,
      repoName: "x",
      branchName: "task-1",
      worktreePath: "/wt/x",
      prUrl: null,
      isDirty: false,
      position: 0,
    },
    {
      repoId: 11,
      repoName: "y",
      branchName: "task-1",
      worktreePath: "/wt/y",
      prUrl: "https://github.com/a/y/pull/2",
      isDirty: false,
      position: 1,
    },
  ],
} as TaskSummary;

describe("taskRepos", () => {
  it("treats undefined and the primary repo id as the primary scope", () => {
    expect(taskRepoPrUrl(task)).toBe("https://github.com/a/x/pull/1");
    expect(taskRepoPrUrl(task, 10)).toBe("https://github.com/a/x/pull/1");
    expect(taskRepoWorktreePath(task)).toBe("/wt/x");
    expect(taskRepoName(task)).toBe("x");
  });

  it("resolves a non-primary member repo from its taskRepos entry", () => {
    expect(taskRepoPrUrl(task, 11)).toBe("https://github.com/a/y/pull/2");
    expect(taskRepoWorktreePath(task, 11)).toBe("/wt/y");
    expect(taskRepoName(task, 11)).toBe("y");
  });

  it("returns null for an unknown repo and handles undefined tasks", () => {
    expect(taskRepoPrUrl(task, 99)).toBeNull();
    expect(taskRepoWorktreePath(task, 99)).toBeNull();
    expect(taskRepoPrUrl(undefined)).toBeNull();
  });

  it("flags only multi-repo tasks as cross-repo", () => {
    expect(isCrossRepoTask(task)).toBe(true);
    expect(isCrossRepoTask({ ...task, taskRepos: [task.taskRepos[0]] })).toBe(false);
    expect(isCrossRepoTask(undefined)).toBe(false);
  });
});
