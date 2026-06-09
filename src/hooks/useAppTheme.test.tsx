import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppTheme } from "./useAppTheme";
import type { AppSettings } from "../types";

const systemSettings: AppSettings = {
  defaultAgentProfileId: 1,
  defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
  defaultBranchPrefix: null,
  jiraBoardJql: null,
  jiraSiteUrl: null,
  jiraBoardProject: null,
  jiraFilterMyIssues: false,
  jiraFilterUnresolved: true,
  jiraFilterCurrentSprint: false,
  jiraFilterStatuses: [],
  theme: "system",
  density: "comfortable",
  updatedAt: "2026-05-16T00:00:00.000Z",
};

function ThemeProbe({ settings }: { settings: AppSettings }) {
  useAppTheme(settings);
  return null;
}

function mockColorSchemeQuery(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === "change" && typeof listener === "function") {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === "change" && typeof listener === "function") {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.spyOn(window, "matchMedia").mockReturnValue(mediaQuery);

  return {
    listeners,
    mediaQuery,
    emitChange() {
      for (const listener of listeners) {
        listener({ matches, media: mediaQuery.media } as MediaQueryListEvent);
      }
    },
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
    },
  };
}

describe("useAppTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-density");
    vi.restoreAllMocks();
  });

  it("updates system theme when the OS color scheme changes", () => {
    const colorScheme = mockColorSchemeQuery(false);

    render(<ThemeProbe settings={systemSettings} />);

    expect(document.documentElement).not.toHaveClass("dark");

    act(() => {
      colorScheme.setMatches(true);
      colorScheme.emitChange();
    });

    expect(document.documentElement).toHaveClass("dark");
  });

  it("removes the system theme listener when leaving system mode", () => {
    const colorScheme = mockColorSchemeQuery(false);
    const { rerender } = render(<ThemeProbe settings={systemSettings} />);

    expect(colorScheme.listeners.size).toBe(1);

    rerender(<ThemeProbe settings={{ ...systemSettings, theme: "dark" }} />);

    expect(colorScheme.listeners.size).toBe(0);
    expect(colorScheme.mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("removes the system theme listener on unmount", () => {
    const colorScheme = mockColorSchemeQuery(false);
    const { unmount } = render(<ThemeProbe settings={systemSettings} />);

    expect(colorScheme.listeners.size).toBe(1);

    unmount();

    expect(colorScheme.listeners.size).toBe(0);
    expect(colorScheme.mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("applies explicit theme and density settings", () => {
    render(<ThemeProbe settings={{ ...systemSettings, theme: "dark", density: "compact" }} />);

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
  });

  it("updates theme and density when settings change", () => {
    const { rerender } = render(<ThemeProbe settings={{ ...systemSettings, theme: "dark", density: "compact" }} />);

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");

    rerender(<ThemeProbe settings={{ ...systemSettings, theme: "light", density: "comfortable" }} />);

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-density", "comfortable");
  });
});
