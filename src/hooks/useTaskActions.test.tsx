import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { resetAppStore } from "../test/testUtils";
import type { TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";
import { useTaskActions } from "./useTaskActions";

vi.mock("../api", () => ({
  api: {
    updateTaskMetadata: vi.fn(),
    setTaskJiraLink: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const timestamp = "2026-06-09T00:00:00.000Z";

const task: TaskSummary = {
  id: 7,
  repoId: 1,
  taskRepos: [{ repoId: 1, repoName: "nectus", isDirty: false, position: 0 }],
  title: "Wire task metadata actions",
  prompt: null,
  status: "review",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/task-actions",
  worktreePath: "/tmp/nectus/task-actions",
  isDirty: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const attention: TaskAttention = {
  taskId: task.id,
  kind: "needs_input",
  title: task.title,
  reason: "approval",
  updatedAt: timestamp,
};

function setup(initialTasks: TaskSummary[] = [task]) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.tasks(), initialTasks);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useTaskActions(), { wrapper });
  return { ...hook, queryClient };
}

describe("useTaskActions", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("replaces the task cache entry and clears attention when a task is marked done", async () => {
    const updatedTask: TaskSummary = {
      ...task,
      status: "done",
      updatedAt: "2026-06-09T00:01:00.000Z",
    };
    mockedApi.updateTaskMetadata.mockResolvedValue(updatedTask);
    useAppStore.setState({ taskAttention: [attention] });
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.updateStatus(task, "done");
    });

    expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({
      taskId: task.id,
      status: "done",
    });
    expect(queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks())).toEqual([updatedTask]);
    expect(useAppStore.getState().taskAttention).toEqual([]);
  });

  it("trims renamed task titles and replaces the task cache entry", async () => {
    const updatedTask: TaskSummary = {
      ...task,
      title: "Retitle task",
      updatedAt: "2026-06-09T00:02:00.000Z",
    };
    mockedApi.updateTaskMetadata.mockResolvedValue(updatedTask);
    const { result, queryClient } = setup();

    act(() => {
      result.current.renameTask(task, "  Retitle task  ");
    });

    await waitFor(() =>
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({
        taskId: task.id,
        title: "Retitle task",
      }),
    );
    expect(queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks())).toEqual([updatedTask]);
  });

  it("does not persist blank or unchanged task titles", () => {
    const { result, queryClient } = setup();

    act(() => {
      result.current.renameTask(task, "  ");
      result.current.renameTask(task, task.title);
    });

    expect(mockedApi.updateTaskMetadata).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks())).toEqual([task]);
  });

  it("sets and clears JIRA links through nullable API fields and cache replacement", async () => {
    const linkedTask: TaskSummary = {
      ...task,
      jiraIssueKey: "NX-42",
      jiraIssueSummary: "Wire metadata actions",
      jiraIssueUrl: "https://example.atlassian.net/browse/NX-42",
      updatedAt: "2026-06-09T00:03:00.000Z",
    };
    const clearedTask: TaskSummary = {
      ...linkedTask,
      jiraIssueKey: null,
      jiraIssueSummary: null,
      jiraIssueUrl: null,
      updatedAt: "2026-06-09T00:04:00.000Z",
    };
    mockedApi.setTaskJiraLink.mockResolvedValueOnce(linkedTask).mockResolvedValueOnce(clearedTask);
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.setTaskJiraLink(task.id, {
        key: "NX-42",
        summary: "Wire metadata actions",
        url: "https://example.atlassian.net/browse/NX-42",
      });
    });

    expect(mockedApi.setTaskJiraLink).toHaveBeenCalledWith({
      taskId: task.id,
      key: "NX-42",
      summary: "Wire metadata actions",
      url: "https://example.atlassian.net/browse/NX-42",
    });
    expect(queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks())).toEqual([linkedTask]);

    await act(async () => {
      await result.current.setTaskJiraLink(task.id, null);
    });

    expect(mockedApi.setTaskJiraLink).toHaveBeenLastCalledWith({
      taskId: task.id,
      key: null,
      summary: null,
      url: null,
    });
    expect(queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks())).toEqual([clearedTask]);
  });
});
