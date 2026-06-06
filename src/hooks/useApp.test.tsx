import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useApp } from "./useApp";
import type { SessionIdleEvent, TaskSummary } from "../types";

const eventTestState = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventTestState.handlers.set(eventName, handler);
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventTestState.listen,
}));

vi.mock("../api", () => ({
  api: {
    listRepos: vi.fn(),
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    listAgentProfiles: vi.fn(),
    listTasks: vi.fn(),
    createCrossRepoTask: vi.fn(),
    getAppSettings: vi.fn(),
    startPairLoop: vi.fn(),
    runPairReview: vi.fn(),
    stopPairLoop: vi.fn(),
    getTaskReviewLoop: vi.fn(),
    listTaskReviewRuns: vi.fn(),
    submitSessionInput: vi.fn(),
    sendSessionInput: vi.fn(),
    sendSystemNotification: vi.fn().mockResolvedValue(true),
    githubStatus: vi.fn().mockResolvedValue({ installed: false, authenticated: false, account: null }),
    createGithubPullRequest: vi.fn(),
    githubPullRequestStatus: vi.fn(),
    jiraStatus: vi
      .fn()
      .mockResolvedValue({ installed: false, authenticated: false, account: null, site: null }),
    jiraRestStatus: vi
      .fn()
      .mockResolvedValue({ connected: false, site: null, email: null, error: null }),
  },
}));

const mockedApi = vi.mocked(api);

const activeTask: TaskSummary = {
  id: 21,
  repoId: 7,
  title: "Continue stale attention",
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/stale-attention",
  worktreePath: "/tmp/stale-attention",
  isDirty: false,
  activeSessionId: "session-21",
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  taskRepos: [],
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

function Harness() {
  const app = useApp();

  return (
    <>
      <output data-testid="tasks">{app.tasks.length}</output>
      <output data-testid="finished">{app.counts.finished}</output>
      <output data-testid="task-status">
        {app.tasks.find((task) => task.id === activeTask.id)?.status ?? "none"}
      </output>
      <output data-testid="review-status">{app.selectedReviewLoop?.status ?? "none"}</output>
      <button type="button" onClick={() => app.onSessionInput("session-21")}>
        send input
      </button>
      <button type="button" onClick={() => app.startReview(activeTask, 1)}>
        start review
      </button>
      <button type="button" onClick={() => app.createPullRequest(activeTask)}>
        create pr
      </button>
      <button type="button" onClick={() => app.setSelectedTaskId(activeTask.id)}>
        select task
      </button>
    </>
  );
}

describe("useApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventTestState.handlers.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 1,
        name: "Codex",
        agentKind: "codex",
        command: "codex",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.getAppSettings.mockResolvedValue({
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
      defaultBranchPrefix: null,
      jiraBoardJql: null,
      jiraSiteUrl: null,
      jiraBoardProject: null,
      jiraFilterMyIssues: false,
      jiraFilterUnresolved: true,
      jiraFilterCurrentSprint: false,
      jiraFilterStatuses: [],
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    mockedApi.listTasks.mockResolvedValue([activeTask]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
    mockedApi.getTaskReviewLoop.mockResolvedValue(null);
    mockedApi.listTaskReviewRuns.mockResolvedValue([]);
    mockedApi.startPairLoop.mockResolvedValue({
      taskId: activeTask.id,
      reviewerProfileId: 1,
      status: "running",
      lastError: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    });
    mockedApi.runPairReview.mockResolvedValue({
      taskId: activeTask.id,
      reviewerProfileId: 1,
      status: "running",
      lastError: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    });
  });

  it("clears finished attention when input is sent to that active session", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });
    await waitFor(() => {
      expect(eventTestState.handlers.has("session_idle")).toBe(true);
    });

    act(() => {
      eventTestState.handlers.get("session_idle")?.({
        payload: {
          sessionId: "session-21",
          taskId: activeTask.id,
          turnId: "turn-1",
          message: "Ready for next instruction",
        } satisfies SessionIdleEvent,
      });
    });

    expect(screen.getByTestId("finished")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: /send input/i }));

    expect(screen.getByTestId("finished")).toHaveTextContent("0");
  });

  it("starts a review loop before triggering an immediate review", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByRole("button", { name: /start review/i }));

    await waitFor(() => {
      expect(mockedApi.startPairLoop).toHaveBeenCalledWith(activeTask.id, 1);
      expect(mockedApi.runPairReview).toHaveBeenCalledWith(activeTask.id);
    });
  });

  it("shows an immediate review as reviewing after triggering it", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByRole("button", { name: /start review/i }));

    await waitFor(() => {
      expect(screen.getByTestId("review-status")).toHaveTextContent("reviewing");
    });
  });

  it("submits a structured create-pr prompt to the active session", async () => {
    mockedApi.submitSessionInput.mockResolvedValue(undefined);
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByRole("button", { name: /create pr/i }));

    await waitFor(() => {
      expect(mockedApi.submitSessionInput).toHaveBeenCalledWith(
        "session-21",
        expect.stringContaining("Create a pull request for this task"),
      );
    });
    expect(mockedApi.submitSessionInput.mock.calls[0]?.[1]).toContain("Conventional Commit");
    expect(mockedApi.submitSessionInput.mock.calls[0]?.[1]).toContain("remote default branch");
    expect(mockedApi.submitSessionInput.mock.calls[0]?.[1]).not.toMatch(/\r$/);
    expect(mockedApi.sendSessionInput).not.toHaveBeenCalled();
  });

  it("marks the selected task done when a review loop passes", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });
    fireEvent.click(screen.getByRole("button", { name: /select task/i }));

    act(() => {
      eventTestState.handlers.get("review_loop_updated")?.({
        payload: {
          taskId: activeTask.id,
          reviewLoop: {
            taskId: activeTask.id,
            reviewerProfileId: 1,
            status: "passed",
            lastError: null,
            createdAt: "2026-05-16T00:00:00.000Z",
            updatedAt: "2026-05-16T00:01:00.000Z",
          },
          reviewRun: null,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("task-status")).toHaveTextContent("done");
    });
  });
});
