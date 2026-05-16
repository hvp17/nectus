import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPointerEvent } from "../test/testUtils";
import { useTaskCardPointerDrag } from "./useTaskCardPointerDrag";

function DragHarness({
  busy = false,
  onDragStart = vi.fn(),
  onPointerDragMove = vi.fn(),
  onPointerDragEnd = vi.fn(),
  onDragEnd = vi.fn(),
}: {
  busy?: boolean;
  onDragStart?: (taskId: number) => void;
  onPointerDragMove?: (clientX: number, clientY: number) => void;
  onPointerDragEnd?: (taskId: number, clientX: number, clientY: number) => void;
  onDragEnd?: () => void;
}) {
  const { cardRef } = useTaskCardPointerDrag({
    taskId: 42,
    busy,
    onDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onDragEnd,
  });

  return (
    <div ref={cardRef} role="button" tabIndex={0}>
      Drag task
    </div>
  );
}

describe("useTaskCardPointerDrag", () => {
  afterEach(() => {
    document.body.classList.remove("task-drag-selection-lock");
    document.querySelectorAll(".task-drag-ghost").forEach((element) => element.remove());
  });

  it("ignores movement below the drag threshold", () => {
    const onDragStart = vi.fn();
    const onPointerDragEnd = vi.fn();
    render(<DragHarness onDragStart={onDragStart} onPointerDragEnd={onPointerDragEnd} />);

    const card = screen.getByRole("button", { name: /drag task/i });
    dispatchPointerEvent(card, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 11, clientY: 10 });
    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 11, clientY: 10 });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onPointerDragEnd).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass("task-drag-selection-lock");
  });

  it("starts and completes pointer drags beyond the threshold", () => {
    const onDragStart = vi.fn();
    const onPointerDragMove = vi.fn();
    const onPointerDragEnd = vi.fn();
    render(
      <DragHarness
        onDragStart={onDragStart}
        onPointerDragMove={onPointerDragMove}
        onPointerDragEnd={onPointerDragEnd}
      />,
    );

    const card = screen.getByRole("button", { name: /drag task/i });
    dispatchPointerEvent(card, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 18, clientY: 10 });
    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 18, clientY: 10 });

    expect(onDragStart).toHaveBeenCalledWith(42);
    expect(onPointerDragMove).toHaveBeenCalledWith(18, 10);
    expect(onPointerDragEnd).toHaveBeenCalledWith(42, 18, 10);
    expect(document.querySelector(".task-drag-ghost")).not.toBeInTheDocument();
  });

  it("does not attach drag tracking while busy", () => {
    const onDragStart = vi.fn();
    render(<DragHarness busy onDragStart={onDragStart} />);

    const card = screen.getByRole("button", { name: /drag task/i });
    dispatchPointerEvent(card, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 18, clientY: 10 });

    expect(onDragStart).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass("task-drag-selection-lock");
  });
});
