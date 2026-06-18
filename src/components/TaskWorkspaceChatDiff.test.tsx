import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { createQueryClient } from "../queries/queryClient";
import { renderWithProviders, resetAppStore } from "../test/testUtils";
import type { AgentProfile, AcpProviderInfo, ChatTranscript, TaskSummary } from "../types";
import { TaskWorkspace } from "./TaskWorkspace";

vi.mock("../api", () => ({
  api: {
    taskDiffSummary: vi.fn(),
    taskDiffFile: vi.fn(),
    getTaskChat: vi.fn(),
    listAgentProfiles: vi.fn(),
    listAcpProviders: vi.fn(),
    acpRespondPermission: vi.fn(),
    acpStopChat: vi.fn(),
    listChatCheckpoints: vi.fn().mockResolvedValue([]),
  },
}));

const mockedApi = vi.mocked(api, true);

const task: TaskSummary = {
  id: 42,
  repoId: 7,
  taskRepos: [],
  title: "Patch parser",
  prompt: "Fix parser",
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/parser",
  worktreePath: "/tmp/worktree",
  isDirty: true,
  archived: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

const profile: AgentProfile = {
  id: 1,
  name: "Codex",
  agentKind: "codex",
  command: "codex",
  model: null,
  args: [],
  env: {},
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

const chat: ChatTranscript = {
  session: {
    id: "chat-1",
    taskId: 42,
    agentProfileId: 1,
    acpSessionId: null,
    cwd: "/tmp/worktree",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  },
  messages: [
    {
      id: "agent-1",
      role: "agent",
      createdAt: "2026-06-15T00:00:00.000Z",
      completedAt: "2026-06-15T00:01:00.000Z",
      parts: [{ type: "file_edit", path: "src/parser.rs", additions: 2, deletions: 1, diff: null }],
    },
  ],
};

const acpProviders: AcpProviderInfo[] = [
  {
    id: "codex",
    agentKind: "codex",
    displayName: "Codex",
    launch: { command: "codex-acp", args: [] },
    capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
    maturity: "preview",
  },
];

function renderWorkspace() {
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.agentProfiles(), [profile]);
  queryClient.setQueryData(queryKeys.acpProviders(), acpProviders);
  queryClient.setQueryData(queryKeys.task.chat(42, 1), chat);

  return renderWithProviders(
    <TaskWorkspace
      task={task}
      agentProfiles={[profile]}
      reviewLoop={null}
      reviewRuns={[]}
      onClose={vi.fn()}
      onConfigureReviewer={vi.fn()}
      onCreatePullRequest={vi.fn()}
      onRefreshPullRequest={vi.fn()}
      onMergePullRequest={vi.fn()}
      onSetPullRequestReady={vi.fn()}
      onClosePullRequest={vi.fn()}
      onUpdateStatus={vi.fn()}
      onRenameTask={vi.fn()}
      onArchiveTask={vi.fn()}
      onDeleteTask={vi.fn()}
      onSetJiraLink={vi.fn()}
    />,
    { queryClient },
  );
}

describe("TaskWorkspace chat-to-diff bridge", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
    mockedApi.taskDiffSummary.mockResolvedValue({
      baseLabel: "origin/main",
      files: [
        { path: "src/other.rs", change: "modified", additions: 1, deletions: 0, binary: false },
        { path: "src/parser.rs", change: "modified", additions: 2, deletions: 1, binary: false },
      ],
    });
    mockedApi.taskDiffFile.mockResolvedValue("@@ -1 +1 @@\n-old\n+new");
    mockedApi.getTaskChat.mockResolvedValue(chat);
    mockedApi.listAgentProfiles.mockResolvedValue([profile]);
    mockedApi.listAcpProviders.mockResolvedValue(acpProviders);
  });

  it("opens the Diff tab with the clicked chat file selected", async () => {
    renderWorkspace();

    await screen.findByTestId("chat-pane", {}, { timeout: 10_000 });
    fireEvent.click(await screen.findByTestId("chat-file-chip", {}, { timeout: 10_000 }));

    expect(await screen.findByLabelText("Task diff")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.taskDiffFile).toHaveBeenCalledWith(42, "src/parser.rs", undefined));
    expect(screen.getByText("parser.rs").closest("button")).toHaveAttribute("aria-pressed", "true");
  });
});
