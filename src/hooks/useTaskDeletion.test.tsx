import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { useTaskDeletion } from "./useTaskDeletion";
import type { TaskSummary } from "../types";

vi.mock("../api", () => ({ api: { deleteTask: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-id"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const mockedToast = vi.mocked(toast);

const baseTask: TaskSummary = {
  id: 1,
  repoId: 7,
  taskRepos: [],
  title: "Delete me",
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: false,
  branchName: null,
  worktreePath: null,
  isDirty: false,
  archived: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

function renderRequestDelete() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTaskDeletion(), { wrapper });
  return result;
}

describe("useTaskDeletion", () => {
  beforeEach(() => {
    mockedApi.deleteTask.mockReset();
    mockedApi.deleteTask.mockResolvedValue(undefined);
    mockedToast.error.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to delete a task with a running session", () => {
    const result = renderRequestDelete();

    result.current({ ...baseTask, id: 11, activeSessionId: "session-11" });

    expect(mockedToast.error).toHaveBeenCalledWith("Delete blocked", expect.anything());
    expect(mockedApi.deleteTask).not.toHaveBeenCalled();
  });

  it("force-discards a dirty worktree-backed task", () => {
    const result = renderRequestDelete();

    result.current({ ...baseTask, id: 12, hasWorktree: true, isDirty: true });

    expect(mockedApi.deleteTask).toHaveBeenCalledWith(12, true);
  });

  it("does not force-discard a clean task", () => {
    const result = renderRequestDelete();

    result.current({ ...baseTask, id: 13, hasWorktree: true, isDirty: false });

    expect(mockedApi.deleteTask).toHaveBeenCalledWith(13, false);
  });
});
