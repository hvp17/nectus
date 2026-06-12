import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import {
  deferred,
  dispatchPointerEvent,
  mockElementRect,
  mockElementsFromPoint,
  pointerDrag,
} from "./testUtils";
import { appRepo, appTask } from "./appFixtures";

const mockedApi = vi.mocked(api);

// The per-project kanban now lives behind the "Board" rail button (the app boots
// into Mission Control). Navigate there, then scope card queries to the board.
async function findBoardCard(title: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: "Board" }));
  const board = await screen.findByTestId("dashboard-layout");
  return within(board).findByRole("button", { name: title });
}

function mockProjectWithTask(title: string, status: "planned" | "done" = "planned") {
  mockedApi.listRepos.mockResolvedValue([appRepo]);
  mockedApi.listTasks.mockResolvedValue([appTask({ title, status })]);
}

function mockTaskStatusUpdate(title: string, status: "review" = "review") {
  mockedApi.updateTaskMetadata.mockResolvedValue(
    appTask({
      title,
      status,
      updatedAt: "2026-05-14T00:01:00.000Z",
    }),
  );
}

export function defineAppTaskBoardTests() {
  it("shows progress and keeps the board interactive while deleting a worktree task", async () => {
    const deletion = deferred<void>();

    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Remove old worktree",
        hasWorktree: true,
        branchName: "delete-flow",
        worktreePath: "/tmp/nectus-desktop-worktrees/delete-flow",
      }),
    ]);
    mockedApi.deleteTask.mockReturnValue(deletion.promise);

    render(<App />);

    const taskCard = await findBoardCard(/remove old worktree/i);
    const deleteButton = within(taskCard).getByRole("button");
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByRole("button", { name: /^delete task$/i }));

    await waitFor(() => {
      expect(screen.queryByText("Delete task?")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Deleting Remove old worktree")).toBeInTheDocument();
    expect(screen.getByText("Removing task and worktree in the background.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new task/i })).toBeEnabled();
    expect(deleteButton).toBeDisabled();
    expect(mockedApi.deleteTask).toHaveBeenCalledWith(31, false);

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });

    await waitFor(() => {
      expect(screen.getByText("Deleted Remove old worktree")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /remove old worktree/i })).not.toBeInTheDocument();
  });

  it("warns about and force-deletes a worktree with uncommitted changes", async () => {
    const deletion = deferred<void>();

    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 33,
        title: "Discard dirty worktree",
        hasWorktree: true,
        branchName: "dirty-flow",
        worktreePath: "/tmp/nectus-desktop-worktrees/dirty-flow",
        isDirty: true,
      }),
    ]);
    mockedApi.deleteTask.mockReturnValue(deletion.promise);

    render(<App />);

    const taskCard = await findBoardCard(/discard dirty worktree/i);
    fireEvent.click(within(taskCard).getByRole("button"));
    expect(await screen.findByText(/uncommitted changes/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^delete task$/i }));

    expect(mockedApi.deleteTask).toHaveBeenCalledWith(33, true);

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });
  });

  it("deletes the selected task from the task inspector sidebar", async () => {
    const deletion = deferred<void>();

    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 32,
        title: "Delete from sidebar",
        hasWorktree: false,
      }),
    ]);
    mockedApi.deleteTask.mockReturnValue(deletion.promise);

    render(<App />);

    fireEvent.click(await findBoardCard(/delete from sidebar/i));
    expect(await screen.findByLabelText(/task inspector/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^delete task$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete task$/i }));

    await waitFor(() => {
      expect(screen.queryByText("Delete task?")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Deleting Delete from sidebar")).toBeInTheDocument();
    expect(screen.getByText("Removing task in the background.")).toBeInTheDocument();
    expect(mockedApi.deleteTask).toHaveBeenCalledWith(32, false);

    await act(async () => {
      deletion.resolve();
      await deletion.promise;
    });

    await waitFor(() => {
      expect(screen.getByText("Deleted Delete from sidebar")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/task inspector/i)).not.toBeInTheDocument();
  });

  it("renames a task from the inspector header title", async () => {
    mockProjectWithTask("Rename me");
    mockedApi.updateTaskMetadata.mockResolvedValue(
      appTask({ title: "Renamed via header", updatedAt: "2026-05-14T00:01:00.000Z" }),
    );

    render(<App />);

    fireEvent.click(await findBoardCard(/rename me/i));
    expect(await screen.findByLabelText(/task inspector/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /rename task/i }));
    const input = screen.getByRole("textbox", { name: /task name/i });
    fireEvent.change(input, { target: { value: "Renamed via header" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, title: "Renamed via header" });
    });
    expect(await screen.findByRole("button", { name: /rename task/i })).toHaveTextContent("Renamed via header");
  });

  it("moves a task to a new status column when dropped there", async () => {
    mockProjectWithTask("Wire task drag and drop");
    mockTaskStatusUpdate("Wire task drag and drop");

    render(<App />);

    const taskCard = await findBoardCard(/wire task drag and drop/i);
    const reviewColumn = screen.getByRole("region", { name: /review/i });

    pointerDrag(taskCard, reviewColumn);

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });
    expect(within(reviewColumn).getByText("Wire task drag and drop")).toBeInTheDocument();
  });

  it("moves a task with native pointer drag feedback", async () => {
    mockProjectWithTask("Wire task pointer drag", "done");
    mockTaskStatusUpdate("Wire task pointer drag");

    render(<App />);

    const taskCard = await findBoardCard(/wire task pointer drag/i);
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const restoreElementsFromPoint = mockElementsFromPoint([reviewColumn]);

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector("[data-task-drag-ghost]")).toBeInstanceOf(HTMLElement);

    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(document.querySelector("[data-task-drag-ghost]")).toBeNull();

    await waitFor(() => {
      expect(mockedApi.updateTaskMetadata).toHaveBeenCalledWith({ taskId: 21, status: "review" });
    });

    restoreElementsFromPoint();
  });

  it("starts native pointer drag after a short pointer movement", async () => {
    mockProjectWithTask("Wire task pointer drag", "done");

    render(<App />);

    const taskCard = await findBoardCard(/wire task pointer drag/i);
    const restoreCardRect = mockElementRect(taskCard, { left: 10, top: 20, width: 220, height: 90 });

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 13, clientY: 20 });

    const ghost = document.querySelector<HTMLElement>("[data-task-drag-ghost]");
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost?.style.transform).toContain("translate3d(");
    expect(ghost?.style.transition).toBe("none");
    expect(ghost?.style.animation).toBe("none");

    dispatchPointerEvent(window, "pointercancel", { pointerId: 1, clientX: 13, clientY: 20 });
    restoreCardRect();
  });

  it("uses cached column bounds to detect the drop target while pointer dragging", async () => {
    mockProjectWithTask("Wire task drag and drop");
    mockTaskStatusUpdate("Wire task drag and drop");

    render(<App />);

    const taskCard = await findBoardCard(/wire task drag and drop/i);
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

    expect(document.querySelector("[data-task-drag-ghost]")).toBeInstanceOf(HTMLElement);
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
    mockProjectWithTask("Wire task drag and drop");

    render(<App />);

    const taskCard = await findBoardCard(/wire task drag and drop/i);
    const reviewColumn = screen.getByRole("region", { name: /review/i });
    const restoreElementsFromPoint = mockElementsFromPoint([reviewColumn]);

    dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });

    expect(reviewColumn).toHaveAttribute("data-drop-available", "true");
    expect(reviewColumn).toHaveAttribute("data-drop-target", "true");

    dispatchPointerEvent(window, "pointercancel", { pointerId: 1, clientX: 40, clientY: 10 });
    restoreElementsFromPoint();
  });
}
