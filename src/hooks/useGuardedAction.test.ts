import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGuardedAction } from "./useGuardedAction";

describe("useGuardedAction", () => {
  it("clears the message, runs the action, and returns its result", async () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() => useGuardedAction(setMessage));

    let value: number | undefined;
    await act(async () => {
      value = await result.current(async () => 42);
    });

    expect(value).toBe(42);
    expect(setMessage).toHaveBeenCalledWith(null);
  });

  it("surfaces a thrown error as a message and returns undefined", async () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() => useGuardedAction(setMessage));

    let value: unknown = "unset";
    await act(async () => {
      value = await result.current(async () => {
        throw new Error("boom");
      });
    });

    expect(value).toBeUndefined();
    expect(setMessage).toHaveBeenCalledWith("Error: boom");
  });

  it("re-throws after surfacing the error when rethrow is set", async () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() => useGuardedAction(setMessage));

    await act(async () => {
      await expect(
        result.current(
          async () => {
            throw new Error("boom");
          },
          { rethrow: true },
        ),
      ).rejects.toThrow("boom");
    });

    expect(setMessage).toHaveBeenCalledWith("Error: boom");
  });

  it("toggles busy around the action and resets it even on failure", async () => {
    const setBusy = vi.fn();
    const { result } = renderHook(() => useGuardedAction(vi.fn(), setBusy));

    await act(async () => {
      await result.current(async () => "ok", { busy: true });
    });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);

    setBusy.mockClear();
    await act(async () => {
      await result.current(
        async () => {
          throw new Error("nope");
        },
        { busy: true },
      );
    });
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("does not toggle busy when busy is not requested", async () => {
    const setBusy = vi.fn();
    const { result } = renderHook(() => useGuardedAction(vi.fn(), setBusy));

    await act(async () => {
      await result.current(async () => "ok");
    });

    expect(setBusy).not.toHaveBeenCalled();
  });
});
