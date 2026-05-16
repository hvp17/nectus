import { useEffect, useRef } from "react";

const DRAG_START_THRESHOLD_PX = 3;
const TASK_DRAG_SELECTION_LOCK_CLASS = "task-drag-selection-lock";

interface UseTaskCardPointerDragArgs {
  taskId: number;
  busy: boolean;
  onDragStart: (taskId: number) => void;
  onPointerDragMove: (clientX: number, clientY: number) => void;
  onPointerDragEnd: (taskId: number, clientX: number, clientY: number) => void;
  onDragEnd: () => void;
}

export function useTaskCardPointerDrag({
  taskId,
  busy,
  onDragStart,
  onPointerDragMove,
  onPointerDragEnd,
  onDragEnd,
}: UseTaskCardPointerDragArgs) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || busy) return;

    let startX = 0;
    let startY = 0;
    let pointerId: number | undefined;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let ghostOffsetX = 0;
    let ghostOffsetY = 0;
    let selectionLocked = false;

    const lockPageSelection = () => {
      selectionLocked = true;
      document.body.classList.add(TASK_DRAG_SELECTION_LOCK_CLASS);
    };

    const unlockPageSelection = () => {
      if (!selectionLocked) return;
      selectionLocked = false;
      document.body.classList.remove(TASK_DRAG_SELECTION_LOCK_CLASS);
    };

    const getClientPosition = (event: PointerEvent) => ({
      clientX: Number.isFinite(event.clientX) ? event.clientX : startX,
      clientY: Number.isFinite(event.clientY) ? event.clientY : startY,
    });

    const moveGhost = (clientX: number, clientY: number) => {
      if (!ghost) return;
      ghost.style.transform = `translate3d(${clientX - ghostOffsetX}px, ${clientY - ghostOffsetY}px, 0) rotate(1deg) scale(0.98)`;
    };

    const removeGhost = () => {
      ghost?.remove();
      ghost = null;
    };

    const createGhost = (clientX: number, clientY: number) => {
      removeGhost();
      const rect = element.getBoundingClientRect();
      ghostOffsetX = clientX - rect.left;
      ghostOffsetY = clientY - rect.top;
      ghost = element.cloneNode(true) as HTMLElement;
      ghost.classList.add("task-drag-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.left = "0";
      ghost.style.top = "0";
      ghost.style.transition = "none";
      ghost.style.animation = "none";
      document.body.appendChild(ghost);
      moveGhost(clientX, clientY);
    };

    const stopTracking = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      unlockPageSelection();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();

      const { clientX, clientY } = getClientPosition(event);
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      if (!dragging && Math.hypot(deltaX, deltaY) < DRAG_START_THRESHOLD_PX) return;

      if (!dragging) {
        dragging = true;
        createGhost(clientX, clientY);
        onDragStart(taskId);
      }

      event.preventDefault();
      moveGhost(clientX, clientY);
      onPointerDragMove(clientX, clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stopTracking();

      if (dragging) {
        const { clientX, clientY } = getClientPosition(event);
        event.preventDefault();
        suppressClickRef.current = true;
        removeGhost();
        onPointerDragEnd(taskId, clientX, clientY);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stopTracking();
      removeGhost();
      onDragEnd();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button > 0 || (event.target as HTMLElement).closest("button")) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      lockPageSelection();
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
    };

    element.addEventListener("pointerdown", onPointerDown);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      stopTracking();
      removeGhost();
    };
  }, [busy, onDragEnd, onDragStart, onPointerDragEnd, onPointerDragMove, taskId]);

  return { cardRef, suppressClickRef };
}
