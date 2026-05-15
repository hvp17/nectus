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
  const monitors: Array<{
    canMonitor?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => boolean;
    onDrop?: (payload: {
      source: { element: HTMLElement; data: Record<string, unknown> };
      location: {
        current: {
          input: { clientX: number; clientY: number };
          dropTargets: Array<{ element: Element; data: Record<string, unknown> }>;
        };
        previous: { dropTargets: Array<{ element: Element; data: Record<string, unknown> }> };
      };
    }) => void;
  }> = [];

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
      getData?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => Record<string, unknown>;
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
        const dropTarget = {
          element: args.element,
          data: args.getData?.({ source: currentSource }) ?? {},
        };
        monitors.forEach((monitor) => {
          if (monitor.canMonitor?.({ source: currentSource! }) === false) return;
          monitor.onDrop?.({
            source: currentSource!,
            location: {
              current: {
                input: { clientX: 0, clientY: 0 },
                dropTargets: [dropTarget],
              },
              previous: { dropTargets: [] },
            },
          });
        });
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
    monitorForElements: (args: {
      canMonitor?: (payload: { source: { element: HTMLElement; data: Record<string, unknown> } }) => boolean;
      onDrop?: (payload: {
        source: { element: HTMLElement; data: Record<string, unknown> };
        location: {
          current: {
            input: { clientX: number; clientY: number };
            dropTargets: Array<{ element: Element; data: Record<string, unknown> }>;
          };
          previous: { dropTargets: Array<{ element: Element; data: Record<string, unknown> }> };
        };
      }) => void;
    }) => {
      monitors.push(args);
      return () => {
        const index = monitors.indexOf(args);
        if (index >= 0) monitors.splice(index, 1);
      };
    },
  };
});

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    window.history.pushState({}, "", "/");
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

  it("renders browser demo tasks without Tauri data when demo mode is enabled", async () => {
    window.history.pushState({}, "", "/?demo=1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Nectus Demo" })).toBeInTheDocument();
    expect(screen.getByText("Drag this task into Review")).toBeInTheDocument();
    expect(mockedApi.listRepos).not.toHaveBeenCalled();
    expect(mockedApi.listTasks).not.toHaveBeenCalled();
  });

  it("moves demo tasks between columns without calling Tauri metadata APIs", async () => {
    window.history.pushState({}, "", "/?demo=1");

    render(<App />);

    const taskCard = await screen.findByRole("button", { name: /drag this task into review/i });
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "1001"),
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(taskCard, { dataTransfer });
    fireEvent.dragEnter(reviewColumn, { dataTransfer });
    fireEvent.drop(reviewColumn, { dataTransfer });

    expect(mockedApi.updateTaskMetadata).not.toHaveBeenCalled();
    expect(within(reviewColumn).getByText("Drag this task into Review")).toBeInTheDocument();
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

  it("moves a task with the pointer fallback in the Tauri webview", async () => {
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
    mockedApi.listTasks.mockResolvedValue([
      {
        id: 21,
        repoId: 7,
        title: "Wire task pointer drag",
        status: "done",
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
      title: "Wire task pointer drag",
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

    const taskCard = await screen.findByRole("button", { name: /wire task pointer drag/i });
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [reviewColumn]),
    });

    fireEvent.pointerDown(taskCard, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector(".task-drag-ghost")).toBeInstanceOf(HTMLElement);

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector(".task-drag-ghost")).toBeNull();

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });

    if (originalElementsFromPoint) {
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: originalElementsFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
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
