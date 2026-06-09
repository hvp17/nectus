import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommandPaletteShortcut } from "./useCommandPaletteShortcut";

function dispatchKey(init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
  const event = new KeyboardEvent("keydown", {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useCommandPaletteShortcut", () => {
  it("toggles on Cmd+K and prevents the browser default", () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    const event = dispatchKey({ key: "k", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles on Ctrl+K (uppercase)", () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    const event = dispatchKey({ key: "K", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated keys and an unmodified k", () => {
    const onToggle = vi.fn();
    renderHook(() => useCommandPaletteShortcut(onToggle));

    expect(dispatchKey({ key: "j", metaKey: true }).defaultPrevented).toBe(false);
    expect(dispatchKey({ key: "k" }).defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const onToggle = vi.fn();
    const { unmount } = renderHook(() => useCommandPaletteShortcut(onToggle));

    unmount();
    dispatchKey({ key: "k", metaKey: true });

    expect(onToggle).not.toHaveBeenCalled();
  });
});
