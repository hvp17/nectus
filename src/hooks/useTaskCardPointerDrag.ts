import { useEffect, useRef } from "react";

const DRAG_START_THRESHOLD_PX = 3;

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
    // True while a drag is in flight and has not yet been ended (dropped or
    // cancelled). Lets the effect cleanup release the board's drag state if the
    // card unmounts or `busy` flips mid-drag, instead of leaving it stuck.
    let dragActive = false;
    let ghost: HTMLElement | null = null;
    let ghostOffsetX = 0;
    let ghostOffsetY = 0;
    let selectionLocked = false;

    // Page-wide selection lock while a drag is tracked, applied as inline body
    // styles (user-select inherits) so it needs no stylesheet support.
    const lockPageSelection = () => {
      selectionLocked = true;
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    };

    const unlockPageSelection = () => {
      if (!selectionLocked) return;
      selectionLocked = false;
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
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
      // The ghost is a transient runtime element: it carries a data marker (for
      // tests/tooling) and inline styles only, so it renders without stylesheet help.
      ghost.dataset.taskDragGhost = "true";
      const style = ghost.style;
      style.position = "fixed";
      style.zIndex = "1000";
      style.pointerEvents = "none";
      style.margin = "0";
      style.opacity = "0.92";
      style.userSelect = "none";
      style.webkitUserSelect = "none";
      style.willChange = "transform";
      style.boxShadow = "0 18px 48px color-mix(in srgb, var(--foreground) 20%, transparent)";
      style.width = `${rect.width}px`;
      style.height = `${rect.height}px`;
      style.left = "0";
      style.top = "0";
      style.transition = "none";
      style.animation = "none";
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
        dragActive = true;
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
      dragActive = false;

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
      dragActive = false;
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
      // If the card unmounts or `busy` flips mid-drag, no pointerup/cancel will
      // fire — release the board's drag/highlight state so it doesn't stick.
      if (dragActive) onDragEnd();
    };
  }, [busy, onDragEnd, onDragStart, onPointerDragEnd, onPointerDragMove, taskId]);

  return { cardRef, suppressClickRef };
}
