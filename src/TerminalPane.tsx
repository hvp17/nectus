import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { api } from "./api";
import type { SessionExitedEvent, SessionOutputEvent } from "./types";

interface TerminalPaneProps {
  sessionId?: string | null;
  onSessionExit: (sessionId: string) => void;
}

interface CachedTerminal {
  terminal: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  dataDisposable: ReturnType<Terminal["onData"]>;
  renderedOffset: number;
  loadingSnapshot: boolean;
  pendingOutput: SessionOutputEvent[];
}

export function TerminalPane({ sessionId, onSessionExit }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalsRef = useRef(new Map<string, CachedTerminal>());
  const sessionIdRef = useRef<string | null | undefined>(sessionId);
  const onSessionExitRef = useRef(onSessionExit);
  const textEncoderRef = useRef(new TextEncoder());
  const textDecoderRef = useRef(new TextDecoder());

  useEffect(() => {
    onSessionExitRef.current = onSessionExit;
  }, [onSessionExit]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!hostRef.current) return;

    const unlistenCallbacks: UnlistenFn[] = [];
    let disposed = false;

    listen<SessionOutputEvent>("session_output", (event) => {
      const cached = terminalsRef.current.get(event.payload.sessionId);
      if (!cached) return;

      if (cached.loadingSnapshot) {
        cached.pendingOutput.push(event.payload);
      } else {
        writeOutput(cached, event.payload.data, event.payload.startOffset);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenCallbacks.push(unlisten);
      }
    });

    listen<SessionExitedEvent>("session_exited", (event) => {
      const cached = terminalsRef.current.get(event.payload.sessionId);
      if (cached) {
        cached.terminal.writeln("\r\nSession stopped.");
        disposeCachedTerminal(event.payload.sessionId);
      }
      onSessionExitRef.current(event.payload.sessionId);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenCallbacks.push(unlisten);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitActiveTerminal();
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unlistenCallbacks.forEach((unlisten) => unlisten());
      for (const sessionId of Array.from(terminalsRef.current.keys())) {
        disposeCachedTerminal(sessionId);
      }
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    for (const [cachedSessionId, cached] of terminalsRef.current) {
      cached.container.hidden = cachedSessionId !== sessionId;
    }
    host.toggleAttribute("data-empty", !sessionId);

    if (!sessionId) {
      return;
    }

    const cached = getOrCreateTerminal(sessionId);
    cached.container.hidden = false;
    fitActiveTerminal();
    loadSnapshotDelta(sessionId, cached);

    return () => {
      cached.container.hidden = true;
    };
  }, [sessionId]);

  const writeOutput = (cached: CachedTerminal, data: string, startOffset: number) => {
    const bytes = textEncoderRef.current.encode(data);
    const endOffset = startOffset + bytes.byteLength;
    if (endOffset <= cached.renderedOffset) return;

    if (startOffset < cached.renderedOffset) {
      const byteOffset = cached.renderedOffset - startOffset;
      cached.terminal.write(textDecoderRef.current.decode(bytes.slice(byteOffset)));
    } else {
      cached.terminal.write(data);
    }
    cached.renderedOffset = endOffset;
  };

  const getOrCreateTerminal = (sessionId: string) => {
    const existing = terminalsRef.current.get(sessionId);
    if (existing) return existing;

    const host = hostRef.current;
    if (!host) {
      throw new Error("Terminal host is not available");
    }

    const container = document.createElement("div");
    container.className = "terminal-session-host";
    host.appendChild(container);

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: {
        background: "#101418",
        foreground: "#d7dde5",
        cursor: "#f4c95d",
        selectionBackground: "#3c4655",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);

    const dataDisposable = terminal.onData((data) => {
      if (sessionIdRef.current === sessionId) {
        api.sendSessionInput(sessionId, data).catch((error) => terminal.writeln(`\r\n${String(error)}`));
      }
    });

    const cached: CachedTerminal = {
      terminal,
      fit,
      container,
      dataDisposable,
      renderedOffset: 0,
      loadingSnapshot: false,
      pendingOutput: [],
    };
    terminalsRef.current.set(sessionId, cached);
    return cached;
  };

  const loadSnapshotDelta = (sessionId: string, cached: CachedTerminal) => {
    if (cached.loadingSnapshot) return;

    cached.loadingSnapshot = true;
    api
      .sessionOutputSnapshot(sessionId)
      .then((snapshot) => {
        if (snapshot.sessionId !== sessionId || terminalsRef.current.get(sessionId) !== cached) return;
        writeOutput(cached, snapshot.data, snapshot.startOffset);
        cached.pendingOutput.splice(0).forEach((output) => {
          writeOutput(cached, output.data, output.startOffset);
        });
      })
      .catch((error) => {
        if (terminalsRef.current.get(sessionId) === cached) {
          cached.terminal.writeln(`\r\nFailed to load terminal history: ${String(error)}`);
        }
      })
      .finally(() => {
        if (terminalsRef.current.get(sessionId) === cached) {
          cached.loadingSnapshot = false;
        }
      });
  };

  const fitActiveTerminal = () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;

    const cached = terminalsRef.current.get(activeSessionId);
    if (!cached || cached.container.hidden) return;

    cached.fit.fit();
    api.resizeSession(activeSessionId, cached.terminal.rows, cached.terminal.cols).catch(() => undefined);
  };

  const disposeCachedTerminal = (sessionId: string) => {
    const cached = terminalsRef.current.get(sessionId);
    if (!cached) return;

    cached.dataDisposable.dispose();
    cached.terminal.dispose();
    cached.container.remove();
    terminalsRef.current.delete(sessionId);
  };

  return <div className="terminal-host" ref={hostRef} />;
}
