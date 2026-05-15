import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    listRepos: vi.fn(),
    listAgentProfiles: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    pickRepositoryFolder: vi.fn(),
    addRepo: vi.fn(),
    updateTaskMetadata: vi.fn(),
    deleteTask: vi.fn(),
    startSession: vi.fn(),
    resumeSession: vi.fn(),
    stopSession: vi.fn(),
    resizeSession: vi.fn(),
    sendSessionInput: vi.fn(),
    sessionOutputSnapshot: vi.fn(),
    sendSystemNotification: vi.fn(),
  },
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => {
  let currentSource: { element: HTMLElement; data: Record<string, unknown> } | null = null;

  return {
    draggable: (args: {
      element: HTMLElement;
      getInitialData?: () => Record<string, unknown>;
      onDragStart?: () => void;
      onDrop?: () => void;
    }) => {
      const dragStart = () => {
        currentSource = {
          element: args.element,
          data: args.getInitialData?.() ?? {},
        };
        args.onDragStart?.();
      };
      const dragEnd = () => {
        currentSource = null;
        args.onDrop?.();
      };

      args.element.setAttribute("draggable", "true");
      args.element.addEventListener("dragstart", dragStart);
      args.element.addEventListener("dragend", dragEnd);

      return () => {
        args.element.removeEventListener("dragstart", dragStart);
        args.element.removeEventListener("dragend", dragEnd);
      };
    },
    dropTargetForElements: (args: {
      element: Element;
      canDrop?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => boolean;
      onDragEnter?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => void;
      onDragLeave?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => void;
      onDrop?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => void;
    }) => {
      const canDrop = () => currentSource && (args.canDrop?.({ source: currentSource }) ?? true);
      const dragEnter = (event: Event) => {
        if (!canDrop() || !currentSource) return;
        event.preventDefault();
        args.onDragEnter?.({ source: currentSource });
      };
      const dragOver = (event: Event) => {
        if (!canDrop()) return;
        event.preventDefault();
      };
      const dragLeave = () => {
        if (!currentSource) return;
        args.onDragLeave?.({ source: currentSource });
      };
      const drop = (event: Event) => {
        if (!canDrop() || !currentSource) return;
        event.preventDefault();
        args.onDrop?.({ source: currentSource });
        currentSource = null;
      };

      args.element.addEventListener("dragenter", dragEnter);
      args.element.addEventListener("dragover", dragOver);
      args.element.addEventListener("dragleave", dragLeave);
      args.element.addEventListener("drop", drop);

      return () => {
        args.element.removeEventListener("dragenter", dragEnter);
        args.element.removeEventListener("dragover", dragOver);
        args.element.removeEventListener("dragleave", dragLeave);
        args.element.removeEventListener("drop", drop);
      };
    },
  };
});

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockedApi.listRepos.mockResolvedValue([]);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 1,
        name: "Codex",
        command: "codex",
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
      {
        id: 2,
        name: "Claude",
        command: "claude",
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listTasks.mockResolvedValue([]);
  });

  it("renders the empty repo state", async () => {
    render(<App />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("opens a task modal and creates a task with an optional title, required agent, prompt, and worktree choice", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.createTask.mockResolvedValue({
      id: 11,
      repoId: 7,
      title: "Review modal task flow",
      status: "planned",
      prUrl: null,
      agentProfileId: 2,
      agentName: "Claude",
      hasWorktree: false,
      branchName: null,
      worktreePath: null,
      isDirty: false,
      activeSessionId: null,
      lastSessionId: null,
      lastSessionAgent: null,
      lastSessionCwd: null,
      lastSessionLabel: null,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: 7,
        title: "Review modal task flow",
        agentProfileId: 2,
        hasWorktree: false,
        branchName: null,
      });
    });
  });

  it("dismisses the alert when the close button is clicked", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.createTask.mockResolvedValue({
      id: 11,
      repoId: 7,
      title: "Review modal task flow",
      status: "planned",
      prUrl: null,
      agentProfileId: 2,
      agentName: "Claude",
      hasWorktree: false,
      branchName: null,
      worktreePath: null,
      isDirty: false,
      activeSessionId: null,
      lastSessionId: null,
      lastSessionAgent: null,
      lastSessionCwd: null,
      lastSessionLabel: null,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

    expect(await screen.findByText("Created Review modal task flow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));

    await waitFor(() => {
      expect(screen.queryByText("Created Review modal task flow")).not.toBeInTheDocument();
    });
  });

  it("automatically dismisses alerts after a short delay", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.createTask.mockResolvedValue({
      id: 11,
      repoId: 7,
      title: "Review modal task flow",
      status: "planned",
      prUrl: null,
      agentProfileId: 2,
      agentName: "Claude",
      hasWorktree: false,
      branchName: null,
      worktreePath: null,
      isDirty: false,
      activeSessionId: null,
      lastSessionId: null,
      lastSessionAgent: null,
      lastSessionCwd: null,
      lastSessionLabel: null,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

    expect(await screen.findByText("Created Review modal task flow")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText("Created Review modal task flow")).not.toBeInTheDocument();
      },
      { timeout: 3500 },
    );
  });

  it("moves a task to a new status column when dropped there", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listTasks.mockResolvedValue([
      {
        id: 21,
        repoId: 7,
        title: "Wire task drag and drop",
        status: "planned",
        prUrl: null,
        agentProfileId: 1,
        agentName: "Codex",
        hasWorktree: false,
        branchName: null,
        worktreePath: null,
        isDirty: false,
        activeSessionId: null,
        lastSessionId: null,
        lastSessionAgent: null,
        lastSessionCwd: null,
        lastSessionLabel: null,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.updateTaskMetadata.mockResolvedValue({
      id: 21,
      repoId: 7,
      title: "Wire task drag and drop",
      status: "review",
      prUrl: null,
      agentProfileId: 1,
      agentName: "Codex",
      hasWorktree: false,
      branchName: null,
      worktreePath: null,
      isDirty: false,
      activeSessionId: null,
      lastSessionId: null,
      lastSessionAgent: null,
      lastSessionCwd: null,
      lastSessionLabel: null,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:01:00.000Z",
    });

    render(<App />);

    const taskCard = await screen.findByRole("button", { name: /wire task drag and drop/i });
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "21"),
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(taskCard, { dataTransfer });
    fireEvent.dragOver(reviewColumn, { dataTransfer });
    fireEvent.drop(reviewColumn, { dataTransfer });

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });
    expect(within(reviewColumn).getByText("Wire task drag and drop")).toBeInTheDocument();
  });

  it("shows drop target feedback while a task is dragged over another status column", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listTasks.mockResolvedValue([
      {
        id: 21,
        repoId: 7,
        title: "Wire task drag and drop",
        status: "planned",
        prUrl: null,
        agentProfileId: 1,
        agentName: "Codex",
        hasWorktree: false,
        branchName: null,
        worktreePath: null,
        isDirty: false,
        activeSessionId: null,
        lastSessionId: null,
        lastSessionAgent: null,
        lastSessionCwd: null,
        lastSessionLabel: null,
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);

    render(<App />);

    const taskCard = await screen.findByRole("button", { name: /wire task drag and drop/i });
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "21"),
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(taskCard, { dataTransfer });
    expect(reviewColumn).toHaveAttribute("data-drop-available", "true");

    fireEvent.dragEnter(reviewColumn, { dataTransfer });

    expect(reviewColumn).toHaveAttribute("data-drop-target", "true");
  });
});
