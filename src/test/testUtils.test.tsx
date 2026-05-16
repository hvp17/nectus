import { describe, expect, it, vi } from "vitest";
import { dispatchPointerEvent, mockElementsFromPoint } from "./testUtils";

describe("test utilities", () => {
  it("dispatches pointer-like events with stable pointer fields", () => {
    const target = document.createElement("button");
    const listener = vi.fn();
    target.addEventListener("pointerdown", listener);

    const event = dispatchPointerEvent(target, "pointerdown", {
      pointerId: 9,
      button: 0,
      clientX: 24,
      clientY: 48,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(event).toMatchObject({
      pointerId: 9,
      button: 0,
      clientX: 24,
      clientY: 48,
    });
  });

  it("restores document.elementsFromPoint after a mock", () => {
    const original = document.elementsFromPoint;
    const element = document.createElement("div");

    const restore = mockElementsFromPoint([element]);

    expect(document.elementsFromPoint(1, 2)).toEqual([element]);

    restore();

    if (original) {
      expect(document.elementsFromPoint).toBe(original);
    } else {
      expect("elementsFromPoint" in document).toBe(false);
    }
  });

  it("lets callers observe preventDefault on dispatched events", () => {
    const target = document.createElement("button");
    target.addEventListener("pointermove", (event) => event.preventDefault());

    const event = dispatchPointerEvent(target, "pointermove", {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });

    expect(event.defaultPrevented).toBe(true);
  });
});
