import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { renderWithTooltipProvider, resetAppStore } from "../test/testUtils";
import type { AgentProfile, ChatTranscript, TaskSummary } from "../types";
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

function renderWorkspace() {
  return renderWithTooltipProvider(
    <TaskWorkspace
      task={task}
      agentProfiles={[profile]}
      reviewLoop={null}
      reviewRuns={[]}
      onClose={vi.fn()}
      onStopSession={vi.fn()}
      onResumeSession={vi.fn()}
      onStartSession={vi.fn()}
      onStartReview={vi.fn()}
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
      onSessionExit={vi.fn()}
      onSessionInput={vi.fn()}
    />,
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
    mockedApi.listAcpProviders.mockResolvedValue([
      {
        id: "codex",
        agentKind: "codex",
        displayName: "Codex",
        launch: { command: "codex-acp", args: [] },
        capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
        maturity: "preview",
      },
    ]);
  });

  it("opens the Diff tab with the clicked chat file selected", async () => {
    renderWorkspace();

    fireEvent.click(screen.getByLabelText("Show chat"));
    fireEvent.click(await screen.findByTestId("chat-file-chip"));

    expect(await screen.findByLabelText("Task diff")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.taskDiffFile).toHaveBeenCalledWith(42, "src/parser.rs", undefined));
    expect(screen.getByText("parser.rs").closest("button")).toHaveAttribute("aria-pressed", "true");
  });
});
