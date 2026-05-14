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

export function TerminalPane({ sessionId, onSessionExit }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

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
    terminal.open(hostRef.current);
    fit.fit();
    termRef.current = terminal;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (sessionId) {
        api.resizeSession(sessionId, terminal.rows, terminal.cols).catch(() => undefined);
      }
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) return;
    terminal.reset();

    if (!sessionId) {
      terminal.writeln("Select a task and start Codex or Claude.");
      return;
    }

    terminal.writeln(`Connected to session ${sessionId}`);
    const dataDisposable = terminal.onData((data) => {
      api.sendSessionInput(sessionId, data).catch((error) => terminal.writeln(`\r\n${String(error)}`));
    });

    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    listen<SessionOutputEvent>("session_output", (event) => {
      if (event.payload.sessionId === sessionId) {
        terminal.write(event.payload.data);
      }
    }).then((unlisten) => {
      unlistenOutput = unlisten;
    });

    listen<SessionExitedEvent>("session_exited", (event) => {
      if (event.payload.sessionId === sessionId) {
        terminal.writeln("\r\nSession stopped.");
        onSessionExit(sessionId);
      }
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    return () => {
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, [onSessionExit, sessionId]);

  return <div className="terminal-host" ref={hostRef} />;
}

