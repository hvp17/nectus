import { useEffect } from "react";

/**
 * Global ⌘K / Ctrl+K listener that toggles the command palette from anywhere.
 * It must live in the always-mounted shell: the palette itself is lazy-mounted
 * only while open, so a listener inside it could not open it from the closed
 * state. `onToggle` should flip the palette's open flag.
 */
export function useCommandPaletteShortcut(onToggle: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
}
