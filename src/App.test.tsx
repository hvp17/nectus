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

const mockedApi = vi.mocked(api);

function mockElementsFromPoint(elements: Element[]) {
  const originalElementsFromPoint = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => elements),
  });
  return () => {
    if (originalElementsFromPoint) {
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: originalElementsFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
  };
}

function dispatchPointerEvent(
  target: Element | Node | Window | Document,
  type: string,
  init: { pointerId: number; button?: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  fireEvent(target, event);
}

function pointerDrag(taskCard: HTMLElement, target: Element) {
  const restoreElementsFromPoint = mockElementsFromPoint([target]);
  dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });
  dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 40, clientY: 10 });
  restoreElementsFromPoint();
}

function mockElementRect(element: Element, rect: Partial<DOMRect>) {
  const fullRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    width: rect.width ?? 100,
    height: rect.height ?? 100,
    top: rect.top ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 100),
    left: rect.left ?? 0,
    toJSON: () => ({}),
  } as DOMRect;
  const spy = vi.spyOn(element, "getBoundingClientRect").mockReturnValue(fullRect);
  return () => spy.mockRestore();
}

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

    pointerDrag(taskCard, reviewColumn);

    expect(mockedApi.updateTaskMetadata).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(within(reviewColumn).getByText("Drag this task into Review")).toBeInTheDocument();
    });
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

    pointerDrag(taskCard, reviewColumn);

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });
    expect(within(reviewColumn).getByText("Wire task drag and drop")).toBeInTheDocument();
  });

  it("moves a task with native pointer drag feedback", async () => {
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
    const restoreElementsFromPoint = mockElementsFromPoint([reviewColumn]);

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector(".task-drag-ghost")).toBeInstanceOf(HTMLElement);

    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector(".task-drag-ghost")).toBeNull();

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });

    restoreElementsFromPoint();
  });

  it("starts native pointer drag after a short pointer movement", async () => {
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

    render(<App />);

    const taskCard = await screen.findByRole("button", { name: /wire task pointer drag/i });
    const restoreCardRect = mockElementRect(taskCard, { left: 10, top: 20, width: 220, height: 90 });

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 13, clientY: 20 });

    const ghost = document.querySelector<HTMLElement>(".task-drag-ghost");
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost?.style.transform).toContain("translate3d(");
    expect(ghost?.style.transition).toBe("none");
    expect(ghost?.style.animation).toBe("none");

    dispatchPointerEvent(window, "pointercancel", { pointerId: 1, clientX: 13, clientY: 20 });
    restoreCardRect();
  });

  it("uses cached column bounds to detect the drop target while pointer dragging", async () => {
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
    const plannedColumn = screen.getByRole("region", { name: /planned/i });
    const inProgressColumn = screen.getByRole("region", { name: /in progress/i });
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const doneColumn = screen.getByRole("region", { name: /done/i });
    const restoreRects = [
      mockElementRect(plannedColumn, { left: 0, top: 0, right: 100, bottom: 500 }),
      mockElementRect(inProgressColumn, { left: 110, top: 0, right: 210, bottom: 500 }),
      mockElementRect(reviewColumn, { left: 220, top: 0, right: 320, bottom: 500 }),
      mockElementRect(doneColumn, { left: 330, top: 0, right: 430, bottom: 500 }),
      mockElementRect(taskCard, { left: 10, top: 20, width: 220, height: 90 }),
    ];
    const restoreElementsFromPoint = mockElementsFromPoint([]);

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 20, clientY: 30 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 23, clientY: 30 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 230, clientY: 30 });

    expect(document.querySelector(".task-drag-ghost")).toBeInstanceOf(HTMLElement);
    await waitFor(() => {
      expect(taskCard).toHaveAttribute("aria-grabbed", "true");
    });
    expect(reviewColumn).toHaveAttribute("data-drop-available", "true");
    await waitFor(() => {
      expect(reviewColumn).toHaveAttribute("data-drop-target", "true");
    });

    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 230, clientY: 30 });

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });

    restoreElementsFromPoint();
    restoreRects.forEach((restore) => restore());
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
    const restoreElementsFromPoint = mockElementsFromPoint([reviewColumn]);

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(reviewColumn).toHaveAttribute("data-drop-available", "true");
    expect(reviewColumn).toHaveAttribute("data-drop-target", "true");

    dispatchPointerEvent(window, "pointercancel", { pointerId: 1, clientX: 40, clientY: 10 });
    restoreElementsFromPoint();
  });
});
