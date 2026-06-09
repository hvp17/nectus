import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { openExternal } from "./lib/openExternal";
import { readTerminalTheme } from "./lib/terminalTheme";
import { isTauriRuntime } from "./lib/tauriRuntime";
import type { SessionExitedEvent, SessionOutputEvent } from "./types";

interface TerminalPaneProps {
  sessionId?: string | null;
  onSessionExit: (sessionId: string) => void;
  onSessionInput: (sessionId: string) => void;
}

interface CachedTerminal {
  terminal: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  dataDisposable: ReturnType<Terminal["onData"]>;
  renderedOffset: number;
  loadingSnapshot: boolean;
  pendingOutput: SessionOutputEvent[];
  /** Last rows/cols pushed to the PTY, so we skip redundant SIGWINCH resizes. */
  ptyRows: number;
  ptyCols: number;
}

const SHELL_PATH_SAFE_CHAR = /[A-Za-z0-9_@%+=:,./-]/;
const SHELL_PATH_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function formatDroppedPaths(paths: string[]) {
  const escapedPaths = paths.filter(Boolean).map(escapeShellPath);
  return escapedPaths.length > 0 ? `${escapedPaths.join(" ")} ` : "";
}

function escapeShellPath(path: string) {
  // Drop control characters first (newline/CR/NUL/tab, DEL): backslash-escaping
  // them would still emit the real byte into the agent's readline — a newline
  // would submit a half-typed prompt.
  const sanitized = Array.from(path)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  if (SHELL_PATH_SAFE.test(sanitized)) return sanitized;
  return Array.from(sanitized)
    .map((char) => (SHELL_PATH_SAFE_CHAR.test(char) ? char : `\\${char}`))
    .join("");
}

// Prefer xterm's GPU (WebGL2) renderer over the default DOM renderer. The DOM
// renderer leaves stale cells behind during the rapid cursor-addressed redraws
// that TUIs like Claude Code use for their status line (ghosting/overlap), and
// mismeasures some glyphs into tofu boxes. WebGL repaints the whole cell grid
// from a texture atlas each frame, so both go away. Fall back to the DOM
// renderer when WebGL2 is unavailable or the context is lost at runtime.
function loadWebglRenderer(terminal: Terminal) {
  try {
    const webgl = new WebglAddon();
    // A lost GPU context can't be recovered in place; dispose so xterm reverts to
    // the DOM renderer instead of freezing on a dead canvas.
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
  } catch (error) {
    console.warn("Terminal: WebGL2 renderer unavailable, using the DOM renderer", error);
  }
}

export function TerminalPane({ sessionId, onSessionExit, onSessionInput }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalsRef = useRef(new Map<string, CachedTerminal>());
  const sessionIdRef = useRef<string | null | undefined>(sessionId);
  const onSessionExitRef = useRef(onSessionExit);
  const onSessionInputRef = useRef(onSessionInput);
  const textEncoderRef = useRef(new TextEncoder());
  const textDecoderRef = useRef(new TextDecoder());

  useEffect(() => {
    onSessionExitRef.current = onSessionExit;
  }, [onSessionExit]);

  useEffect(() => {
    onSessionInputRef.current = onSessionInput;
  }, [onSessionInput]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!hostRef.current || !isTauriRuntime()) return;

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

    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;

      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || event.payload.paths.length === 0) return;

      const cached = terminalsRef.current.get(activeSessionId);
      if (!cached || cached.container.hidden) return;

      const input = formatDroppedPaths(event.payload.paths);
      if (input) {
        sendSessionData(activeSessionId, input, cached.terminal);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenCallbacks.push(unlisten);
      }
    });

    // Coalesce resize bursts (a window drag fires dozens of ticks) into one fit
    // per frame, so the agent repaints its cursor-addressed UI once, not on every
    // intermediate pixel — repeated repaints overlap into ghosted/duplicate lines.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fitActiveTerminal();
      });
    });
    resizeObserver.observe(hostRef.current);

    const themeObserver = new MutationObserver(() => {
      const theme = readTerminalTheme();
      for (const cached of terminalsRef.current.values()) {
        cached.terminal.options.theme = theme;
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      disposed = true;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
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

    if (!isTauriRuntime()) {
      return;
    }

    const cached = getOrCreateTerminal(sessionId);
    cached.container.hidden = false;
    // Sizing is owned by loadSnapshotDelta: it must replay buffered output at the
    // width it was generated at before fitting the PTY to the pane, otherwise the
    // agent's cursor-addressed redraws land on the wrong rows (ghosting/overlap).
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
      // Required by Unicode11Addon (terminal.unicode.activeVersion is proposed API).
      allowProposedApi: true,
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Unicode 11 width tables so emoji/CJK occupy the same cell count the agent
    // assumes; a width disagreement desyncs its cursor-addressed redraws.
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    // Highlight URLs and open clicks in the system browser, not inside the webview.
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        openExternal(uri);
      }),
    );
    terminal.open(container);
    // Must run after open(): the WebGL renderer needs the terminal's canvas.
    loadWebglRenderer(terminal);

    const dataDisposable = terminal.onData((data) => {
      if (sessionIdRef.current === sessionId) {
        sendSessionData(sessionId, data, terminal);
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
      ptyRows: 0,
      ptyCols: 0,
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
        // For a fresh terminal, match the width the buffer was generated at before
        // replaying so cursor-addressed redraws reproduce faithfully. Existing
        // terminals already hold rendered content, so leave their size to the fit.
        if (cached.renderedOffset === 0 && snapshot.cols > 0 && snapshot.rows > 0) {
          cached.terminal.resize(snapshot.cols, snapshot.rows);
          // The PTY already runs at its recorded generation size, so treat that as
          // the live size: syncTerminalToPane only resizes if the pane differs.
          cached.ptyRows = snapshot.rows;
          cached.ptyCols = snapshot.cols;
        }
        writeOutput(cached, snapshot.data, snapshot.startOffset);
        cached.pendingOutput.splice(0).forEach((output) => {
          writeOutput(cached, output.data, output.startOffset);
        });
        // History is now rendered; switch the live terminal to the pane size so
        // the agent redraws (via SIGWINCH) at the size the user actually sees.
        syncTerminalToPane(sessionId, cached);
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

  const syncTerminalToPane = (sessionId: string, cached: CachedTerminal) => {
    if (cached.container.hidden) return;
    cached.fit.fit();
    const { rows, cols } = cached.terminal;
    // Only SIGWINCH the PTY when the grid actually changed. A redundant resize
    // forces the agent to repaint its cursor-addressed UI, which — especially in a
    // short pane — overlaps into ghosted/duplicate lines.
    if (rows === cached.ptyRows && cols === cached.ptyCols) return;
    cached.ptyRows = rows;
    cached.ptyCols = cols;
    api.resizeSession(sessionId, rows, cols).catch(() => undefined);
  };

  const fitActiveTerminal = () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;

    const cached = terminalsRef.current.get(activeSessionId);
    if (!cached || cached.container.hidden) return;
    // Don't resize the PTY mid-replay: it would change the recorded generation
    // size out from under the snapshot we're still rendering.
    if (cached.loadingSnapshot) return;

    syncTerminalToPane(activeSessionId, cached);
  };

  const sendSessionData = (targetSessionId: string, data: string, terminal: Terminal) => {
    onSessionInputRef.current(targetSessionId);
    api.sendSessionInput(targetSessionId, data).catch((error) => terminal.writeln(`\r\n${String(error)}`));
  };

  const disposeCachedTerminal = (sessionId: string) => {
    const cached = terminalsRef.current.get(sessionId);
    if (!cached) return;

    cached.dataDisposable.dispose();
    cached.terminal.dispose();
    cached.container.remove();
    terminalsRef.current.delete(sessionId);
  };

  return (
    <div
      className="terminal-host"
      ref={hostRef}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => event.preventDefault()}
    />
  );
}
