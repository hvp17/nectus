import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTauriEvent } from "./useTauriEvent";

// Capture registered handlers and a per-subscription unlisten spy.
const { listeners, unlistens, listenMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const unlistens: ReturnType<typeof vi.fn>[] = [];
  const listenMock = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    const unlisten = vi.fn(() => listeners.delete(name));
    unlistens.push(unlisten);
    return unlisten;
  });
  return { listeners, unlistens, listenMock };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("useTauriEvent", () => {
  beforeEach(() => {
    listeners.clear();
    unlistens.length = 0;
    listenMock.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("delivers the event payload to the handler", async () => {
    const handler = vi.fn();
    renderHook(() => useTauriEvent<{ n: number }>("ping", handler));
    await waitFor(() => expect(listeners.has("ping")).toBe(true));

    act(() => listeners.get("ping")?.({ payload: { n: 7 } }));

    expect(handler).toHaveBeenCalledWith({ n: 7 });
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useTauriEvent("ping", vi.fn()));
    await waitFor(() => expect(unlistens).toHaveLength(1));

    unmount();

    expect(unlistens[0]).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe while disabled", () => {
    renderHook(() => useTauriEvent("ping", vi.fn(), { enabled: false }));
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("does not subscribe outside the Tauri runtime", () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    renderHook(() => useTauriEvent("ping", vi.fn()));
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("calls the latest handler without resubscribing on re-render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }) => useTauriEvent("ping", h), {
      initialProps: { h: first },
    });
    await waitFor(() => expect(listeners.has("ping")).toBe(true));

    rerender({ h: second });
    act(() => listeners.get("ping")?.({ payload: 1 }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
    expect(listenMock).toHaveBeenCalledTimes(1);
  });
});
