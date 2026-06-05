import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";
import { api } from "./api";

const terminalTestState = vi.hoisted(() => {
  const instances: MockTerminal[] = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  let dragDropHandler: ((event: { payload: unknown }) => void) | undefined;
  // Simulates a browser without WebGL2 (or a lost context): loading the WebGL
  // addon throws, exercising the DOM-renderer fallback in loadWebglRenderer.
  let shouldFailWebgl = false;

  class MockWebglAddon {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  }

  // Capture the WebLinksAddon click handler so a test can invoke it.
  let webLinksHandler: ((event: { preventDefault(): void }, uri: string) => void) | undefined;
  class MockWebLinksAddon {
    constructor(handler?: (event: { preventDefault(): void }, uri: string) => void) {
      webLinksHandler = handler;
    }
  }
  class MockUnicode11Addon {}

  class MockTerminal {
    rows = 24;
    cols = 80;
    options: Record<string, unknown>;
    unicode = { activeVersion: "6" };
    resize = vi.fn();
    write = vi.fn();
    loadAddon = vi.fn((addon: unknown) => {
      // Unicode11Addon touches proposed API, which xterm guards behind
      // allowProposedApi — mirror that so a missing flag fails the test, not prod.
      if (addon instanceof MockUnicode11Addon && this.options.allowProposedApi !== true) {
        throw new Error("You must set the allowProposedApi option to true to use proposed API");
      }
      if (shouldFailWebgl && addon instanceof MockWebglAddon) {
        throw new Error("WebGL2 is not supported");
      }
    });
    private dataHandler?: (data: string) => void;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      instances.push(this);
    }

    open() {}
    writeln() {}
    dispose() {}

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }
  }

  class MockFitAddon {
    fit = vi.fn();
  }

  return {
    instances,
    handlers,
    MockWebglAddon,
    MockWebLinksAddon,
    MockUnicode11Addon,
    getWebLinksHandler: () => webLinksHandler,
    setWebglFailure: (value: boolean) => {
      shouldFailWebgl = value;
    },
    getDragDropHandler: () => dragDropHandler,
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(eventName, handler);
      return vi.fn(() => handlers.delete(eventName));
    }),
    getCurrentWebview: vi.fn(() => ({
      onDragDropEvent: vi.fn(async (handler: (event: { payload: unknown }) => void) => {
        dragDropHandler = handler;
        return vi.fn(() => {
          dragDropHandler = undefined;
        });
      }),
    })),
    resetDragDropHandler: () => {
      dragDropHandler = undefined;
    },
    MockTerminal,
    MockFitAddon,
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: terminalTestState.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: terminalTestState.MockFitAddon,
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: terminalTestState.MockWebglAddon,
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: terminalTestState.MockWebLinksAddon,
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: terminalTestState.MockUnicode11Addon,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: terminalTestState.listen,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: terminalTestState.getCurrentWebview,
}));

vi.mock("./api", () => ({
  api: {
    resizeSession: vi.fn().mockResolvedValue(undefined),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    sessionOutputSnapshot: vi.fn().mockResolvedValue({
      sessionId: "session-21",
      data: "",
      truncated: false,
      startOffset: 0,
      endOffset: 0,
      // Differs from the mock terminal's 80x24 pane so the post-replay PTY sync
      // still fires past the "skip unchanged size" guard.
      cols: 100,
      rows: 28,
    }),
  },
}));

const mockedApi = vi.mocked(api);

describe("TerminalPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalTestState.instances.length = 0;
    terminalTestState.handlers.clear();
    terminalTestState.resetDragDropHandler();
    terminalTestState.setWebglFailure(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("notifies the app when user input is sent to a session", async () => {
    const onSessionInput = vi.fn();

    render(
      <TerminalPane
        sessionId="session-21"
        onSessionExit={vi.fn()}
        onSessionInput={onSessionInput}
      />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    act(() => {
      terminalTestState.instances[0].emitData("Continue\n");
    });

    expect(onSessionInput).toHaveBeenCalledWith("session-21");
    expect(mockedApi.sendSessionInput).toHaveBeenCalledWith("session-21", "Continue\n");
  });

  it("loads the WebGL renderer for crisp, flicker-free terminal output", async () => {
    render(
      <TerminalPane sessionId="session-21" onSessionExit={vi.fn()} onSessionInput={vi.fn()} />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    expect(terminalTestState.instances[0].loadAddon).toHaveBeenCalledWith(
      expect.any(terminalTestState.MockWebglAddon),
    );
  });

  it("falls back to the DOM renderer when WebGL2 is unavailable", async () => {
    terminalTestState.setWebglFailure(true);

    render(
      <TerminalPane sessionId="session-21" onSessionExit={vi.fn()} onSessionInput={vi.fn()} />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    // The WebGL load was attempted but threw; the session must still finish
    // wiring up (history replay + PTY sync) instead of crashing.
    await waitFor(() => {
      expect(mockedApi.resizeSession).toHaveBeenCalledWith("session-21", 24, 80);
    });
  });

  it("replays history at the snapshot's generation size, then syncs the PTY to the pane", async () => {
    mockedApi.sessionOutputSnapshot.mockResolvedValueOnce({
      sessionId: "session-21",
      data: "buffered output",
      truncated: false,
      startOffset: 0,
      endOffset: 15,
      cols: 100,
      rows: 28,
    });

    render(
      <TerminalPane sessionId="session-21" onSessionExit={vi.fn()} onSessionInput={vi.fn()} />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    const terminal = terminalTestState.instances[0];

    // History must be replayed at the width it was generated at, otherwise the
    // agent's cursor-addressed redraws land on the wrong rows (ghosting/overlap).
    await waitFor(() => {
      expect(terminal.resize).toHaveBeenCalledWith(100, 28);
      expect(terminal.write).toHaveBeenCalledWith("buffered output");
    });

    // The resize to generation size must happen before any output is written.
    const resizeOrder = terminal.resize.mock.invocationCallOrder[0];
    const writeOrder = terminal.write.mock.invocationCallOrder[0];
    expect(resizeOrder).toBeLessThan(writeOrder);

    // After replay, the PTY is synced to the pane (mock terminal stays 24x80).
    expect(mockedApi.resizeSession).toHaveBeenCalledWith("session-21", 24, 80);
  });

  it("sends dropped file paths to the active session when files are dropped on the terminal", async () => {
    const onSessionInput = vi.fn();
    const { container } = render(
      <TerminalPane
        sessionId="session-21"
        onSessionExit={vi.fn()}
        onSessionInput={onSessionInput}
      />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    expect(container.querySelector<HTMLElement>(".terminal-host")).not.toBeNull();

    act(() => {
      terminalTestState.getDragDropHandler()?.({
        payload: {
          type: "drop",
          paths: ["/Users/tomas/Desktop/screenshot 1.png", "/tmp/report (final).pdf"],
          position: { x: 20, y: 20 },
        },
      });
    });

    expect(onSessionInput).toHaveBeenCalledWith("session-21");
    expect(mockedApi.sendSessionInput).toHaveBeenCalledWith(
      "session-21",
      "/Users/tomas/Desktop/screenshot\\ 1.png /tmp/report\\ \\(final\\).pdf ",
    );
  });

  it("activates Unicode 11 width tables so wide glyphs match the agent's layout", async () => {
    render(
      <TerminalPane sessionId="session-21" onSessionExit={vi.fn()} onSessionInput={vi.fn()} />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    expect(terminalTestState.instances[0].unicode.activeVersion).toBe("11");
  });

  it("opens terminal hyperlinks in the system browser", async () => {
    render(
      <TerminalPane sessionId="session-21" onSessionExit={vi.fn()} onSessionInput={vi.fn()} />,
    );

    await waitFor(() => {
      expect(terminalTestState.instances).toHaveLength(1);
    });

    const openLink = terminalTestState.getWebLinksHandler();
    expect(openLink).toBeTypeOf("function");

    const preventDefault = vi.fn();
    openLink?.({ preventDefault }, "https://example.com/docs");

    expect(preventDefault).toHaveBeenCalled();
    expect(mockedApi.openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
  });
});
