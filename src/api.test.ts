import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedIsPermissionGranted = vi.mocked(isPermissionGranted);
const mockedRequestPermission = vi.mocked(requestPermission);
const mockedSendNotification = vi.mocked(sendNotification);

describe("api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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

  it("starts a pair loop with reviewer profile and max rounds", async () => {
    mockedInvoke.mockResolvedValueOnce({
      taskId: 2,
      reviewerProfileId: 4,
      maxRounds: 3,
      currentRound: 0,
      status: "running",
      lastError: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    });

    await api.startPairLoop(2, 4, 3);

    expect(mockedInvoke).toHaveBeenCalledWith("start_pair_loop", {
      taskId: 2,
      reviewerProfileId: 4,
      maxRounds: 3,
    });
  });

  it("runs an immediate pair review for a task", async () => {
    await api.runPairReview(2);

    expect(mockedInvoke).toHaveBeenCalledWith("run_pair_review", {
      taskId: 2,
    });
  });

  it("truncates long system notification bodies sent to Tauri", async () => {
    vi.resetModules();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    mockedIsPermissionGranted.mockResolvedValue(true);

    const { api: tauriApi } = await import("./api");

    await tauriApi.sendSystemNotification("Codex finished", "A".repeat(300));

    expect(mockedRequestPermission).not.toHaveBeenCalled();
    expect(mockedSendNotification).toHaveBeenCalledWith({
      title: "Codex finished",
      body: `${"A".repeat(177)}...`,
    });
  });
});
