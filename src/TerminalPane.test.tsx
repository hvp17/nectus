import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";
import { api } from "./api";

const terminalTestState = vi.hoisted(() => {
  const instances: MockTerminal[] = [];

  class MockTerminal {
    rows = 24;
    cols = 80;
    private dataHandler?: (data: string) => void;

    constructor() {
      instances.push(this);
    }

    loadAddon() {}
    open() {}
    write() {}
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
    listen: vi.fn(async () => vi.fn()),
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: terminalTestState.listen,
}));

vi.mock("./api", () => ({
  api: {
    resizeSession: vi.fn().mockResolvedValue(undefined),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sessionOutputSnapshot: vi.fn().mockResolvedValue({
      sessionId: "session-21",
      data: "",
      truncated: false,
      startOffset: 0,
      endOffset: 0,
    }),
  },
}));

const mockedApi = vi.mocked(api);

describe("TerminalPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalTestState.instances.length = 0;
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
});
