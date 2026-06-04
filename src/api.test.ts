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
      jiraIssueKey: null,
      jiraIssueSummary: null,
      jiraIssueUrl: null,
    });
  });

  it("starts review tracking with reviewer profile", async () => {
    mockedInvoke.mockResolvedValueOnce({
      taskId: 2,
      reviewerProfileId: 4,
      status: "running",
      lastError: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    });

    await api.startPairLoop(2, 4);

    expect(mockedInvoke).toHaveBeenCalledWith("start_pair_loop", {
      taskId: 2,
      reviewerProfileId: 4,
    });
  });

  it("runs an immediate pair review for a task", async () => {
    await api.runPairReview(2);

    expect(mockedInvoke).toHaveBeenCalledWith("run_pair_review", {
      taskId: 2,
    });
  });

  it("submits terminal input through the app-authored prompt command", async () => {
    await api.submitSessionInput("session-21", "Create a pull request");

    expect(mockedInvoke).toHaveBeenCalledWith("submit_session_input", {
      sessionId: "session-21",
      data: "Create a pull request",
    });
  });

  it("queues a PR review with default-null reviewers and rounds", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: 1, prNumber: 3 });

    await api.createPrReview({ prUrl: "https://github.com/owner/repo/pull/3" });

    expect(mockedInvoke).toHaveBeenCalledWith("create_pr_review", {
      prUrl: "https://github.com/owner/repo/pull/3",
      reviewerProfileIds: null,
      maxRounds: null,
    });
  });

  it("passes a single chosen reviewer when queuing a PR review", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: 1, prNumber: 3 });

    await api.createPrReview({ prUrl: "https://github.com/owner/repo/pull/3", reviewerProfileIds: [4] });

    expect(mockedInvoke).toHaveBeenCalledWith("create_pr_review", {
      prUrl: "https://github.com/owner/repo/pull/3",
      reviewerProfileIds: [4],
      maxRounds: null,
    });
  });

  it("passes multiple reviewers and a round cap for a consensus review", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: 1, prNumber: 3 });

    await api.createPrReview({
      prUrl: "https://github.com/owner/repo/pull/3",
      reviewerProfileIds: [4, 2],
      maxRounds: 3,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("create_pr_review", {
      prUrl: "https://github.com/owner/repo/pull/3",
      reviewerProfileIds: [4, 2],
      maxRounds: 3,
    });
  });

  it("returns no PR reviews outside Tauri", async () => {
    const reviews = await api.listPrReviews();

    expect(reviews).toEqual([]);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("returns a disconnected GitHub status outside Tauri", async () => {
    const status = await api.githubStatus();

    expect(status).toEqual({ installed: false, authenticated: false, account: null });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("creates a GitHub pull request through the native command", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValueOnce({
      id: 5,
      repoId: 1,
      title: "Add GitHub panel",
      status: "review",
      prUrl: "https://github.com/hvp17/nectus/pull/9",
      hasWorktree: true,
      isDirty: false,
      createdAt: "2026-06-02T12:00:00.000Z",
      updatedAt: "2026-06-02T12:01:00.000Z",
    });

    await api.createGithubPullRequest({ taskId: 5, title: "Add GitHub panel", body: "Body", draft: true });

    expect(mockedInvoke).toHaveBeenCalledWith("create_github_pull_request", {
      taskId: 5,
      title: "Add GitHub panel",
      body: "Body",
      draft: true,
    });
  });

  it("requests live pull request status for a task", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValueOnce({
      number: 9,
      url: "https://github.com/hvp17/nectus/pull/9",
      title: "Add GitHub panel",
      state: "open",
      isDraft: false,
      reviewDecision: "review_required",
      checks: { total: 2, passed: 1, failed: 0, pending: 1 },
      checksState: "pending",
    });

    const info = await api.githubPullRequestStatus(9);

    expect(info.number).toBe(9);
    expect(mockedInvoke).toHaveBeenCalledWith("github_pull_request_status", { taskId: 9 });
  });

  it("detects an existing pull request for a task branch", async () => {
    // `isTauri` is captured at module load, so re-import with the flag present.
    vi.resetModules();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValueOnce({
      id: 5,
      repoId: 1,
      title: "Add GitHub panel",
      status: "review",
      prUrl: "https://github.com/hvp17/nectus/pull/9",
      hasWorktree: true,
      isDirty: false,
      createdAt: "2026-06-02T12:00:00.000Z",
      updatedAt: "2026-06-02T12:01:00.000Z",
    });

    const { api: tauriApi } = await import("./api");
    const task = await tauriApi.detectGithubPullRequest(5);

    expect(task?.prUrl).toBe("https://github.com/hvp17/nectus/pull/9");
    expect(mockedInvoke).toHaveBeenCalledWith("detect_github_pull_request", { taskId: 5 });
  });

  it("returns no detected pull request outside Tauri", async () => {
    const task = await api.detectGithubPullRequest(5);

    expect(task).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
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
