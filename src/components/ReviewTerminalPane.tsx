import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ScanEye } from "lucide-react";
import { useEffect, useRef } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { readTerminalTheme } from "../lib/terminalTheme";
import { reviewTerminalOutputDelta } from "../lib/reviewTerminalOutput";

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
 * watch the review progress without being able to type into it. There is no
 * input or snapshot: output is handed in as an ever-growing string and written
 * to xterm in deltas.
 */
export function ReviewTerminalPane({ output, active }: ReviewTerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  // What has already been written, so appends can stream as suffixes while
  // replacements reset and replay instead of mixing old and new review output.
  const renderedOutputRef = useRef("");
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
    renderedOutputRef.current = "";
    const initialOutput = reviewTerminalOutputDelta(renderedOutputRef.current, outputRef.current);
    if (initialOutput.chunk) terminal.write(initialOutput.chunk);
    renderedOutputRef.current = initialOutput.renderedOutput;
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
      renderedOutputRef.current = "";
    };
  }, []);

  useEffect(() => {
    const handle = terminalRef.current;
    if (!handle) return;

    const nextOutput = reviewTerminalOutputDelta(renderedOutputRef.current, output);
    if (nextOutput.reset) {
      handle.terminal.reset();
    }
    if (nextOutput.chunk) handle.terminal.write(nextOutput.chunk);
    renderedOutputRef.current = nextOutput.renderedOutput;
  }, [output]);

  return (
    <div className="relative h-full min-h-0 bg-card p-2.5" data-testid="review-terminal">
      <div ref={hostRef} className="h-full w-full" />
      {output.length === 0 && (
        <Empty className="absolute inset-0 border-none">
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
