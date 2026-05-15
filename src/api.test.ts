import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends explicit nulls for omitted task metadata fields", async () => {
    mockedInvoke.mockResolvedValueOnce({
      id: 1,
      repoId: 1,
      title: "Move me",
      status: "review",
      hasWorktree: false,
      isDirty: false,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:01:00.000Z",
    });

    await api.updateTaskMetadata({ taskId: 1, status: "review" });

    expect(mockedInvoke).toHaveBeenCalledWith("update_task_metadata", {
      taskId: 1,
      title: null,
      status: "review",
      prUrl: null,
    });
  });

  it("sends a task prompt when creating a task", async () => {
    mockedInvoke.mockResolvedValueOnce({
      id: 2,
      repoId: 1,
      title: "Refactor auth logic",
      prompt: "Refactor auth logic and add tests",
      status: "planned",
      hasWorktree: false,
      isDirty: false,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:01:00.000Z",
    });

    await api.createTask({
      repoId: 1,
      title: "Refactor auth logic",
      prompt: "Refactor auth logic and add tests",
      agentProfileId: 1,
      hasWorktree: false,
      branchName: null,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("create_task", {
      repoId: 1,
      title: "Refactor auth logic",
      prompt: "Refactor auth logic and add tests",
      agentProfileId: 1,
      hasWorktree: false,
      branchName: null,
    });
  });
});
