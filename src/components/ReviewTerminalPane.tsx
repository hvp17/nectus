import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ScanEye } from "lucide-react";
import { useEffect, useRef } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { readTerminalTheme } from "../lib/terminalTheme";

interface ReviewTerminalPaneProps {
  /** Accumulated reviewer output — the live stream while a review runs, or the
   *  last recorded run's output once it has finished. Grows by appending; an
   *  empty string between runs resets the view. */
  output: string;
  /** True while a review is actively running, for the waiting/empty copy. */
  active: boolean;
}

// xterm renders to a canvas the jsdom test environment can't drive, so skip
// terminal creation under the test runner and assert on the empty-state copy
// instead. The real app (Tauri) and browser preview both render the terminal.
const ENABLE_TERMINAL = import.meta.env.MODE !== "test";

/**
 * Read-only terminal that mirrors a task reviewer's live stdout so the user can
 * watch the review progress without being able to type into it. Unlike
 * `TerminalPane` there is no session, input, or snapshot: output is handed in as
 * an ever-growing string and written to xterm in deltas.
 */
export function ReviewTerminalPane({ output, active }: ReviewTerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  // How much of `output` has already been written, so growth can be appended
  // rather than re-rendering the whole buffer on every chunk.
  const writtenRef = useRef(0);
  const outputRef = useRef(output);

  useEffect(() => {
    outputRef.current = output;
  }, [output]);

  useEffect(() => {
    if (!ENABLE_TERMINAL) return;
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = { terminal, fit };

    // Replay whatever output already accumulated before this pane mounted (the
    // live stream runs whether or not the Review tab is the visible one).
    writtenRef.current = 0;
    if (outputRef.current) {
      terminal.write(outputRef.current);
      writtenRef.current = outputRef.current.length;
    }
    fit.fit();

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(host);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTerminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      writtenRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const handle = terminalRef.current;
    if (!handle) return;

    // A shorter buffer means a new run replaced the old output: clear and replay.
    if (output.length < writtenRef.current) {
      handle.terminal.reset();
      writtenRef.current = 0;
    }
    if (output.length > writtenRef.current) {
      handle.terminal.write(output.slice(writtenRef.current));
      writtenRef.current = output.length;
    }
  }, [output]);

  return (
    <div className="review-terminal" data-testid="review-terminal">
      <div ref={hostRef} className="review-terminal-host" />
      {output.length === 0 && (
        <Empty className="review-terminal-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScanEye />
            </EmptyMedia>
            <EmptyTitle>{active ? "Waiting for the reviewer" : "No review output yet"}</EmptyTitle>
            <EmptyDescription>
              {active
                ? "The reviewer's output will stream here as it inspects the worktree."
                : "Start a review to watch the reviewer work here in real time."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
