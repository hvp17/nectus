import type { ReactElement } from "react";
import { fireEvent, render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";

export type TestPointerEvent = Event & {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
};

export function renderWithTooltipProvider(ui: ReactElement, options?: RenderOptions) {
  return render(<TooltipProvider>{ui}</TooltipProvider>, options);
}

export function mockElementsFromPoint(elements: Element[]) {
  const originalElementsFromPoint = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => elements,
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

export function dispatchPointerEvent(
  target: Element | Node | Window | Document,
  type: string,
  init: { pointerId: number; button?: number; clientX: number; clientY: number },
): TestPointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TestPointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  fireEvent(target, event);
  return event;
}

export function pointerDrag(taskCard: HTMLElement, target: Element) {
  const restoreElementsFromPoint = mockElementsFromPoint([target]);
  dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });
  dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 40, clientY: 10 });
  restoreElementsFromPoint();
}

export function mockElementRect(element: Element, rect: Partial<DOMRect>) {
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

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
