import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinuteNow } from "./useMinuteNow";

function Probe() {
  return <output>{useMinuteNow()}</output>;
}

describe("useMinuteNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the current time and refreshes once a minute", () => {
    render(<Probe />);

    expect(screen.getByText(String(Date.parse("2026-06-09T00:00:00.000Z")))).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText(String(Date.parse("2026-06-09T00:01:00.000Z")))).toBeInTheDocument();
  });

  it("clears the interval on unmount", () => {
    const clearInterval = vi.spyOn(window, "clearInterval");
    const { unmount } = render(<Probe />);

    unmount();

    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});
