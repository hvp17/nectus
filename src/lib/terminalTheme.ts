import type { ITheme } from "@xterm/xterm";

// xterm needs concrete color strings, so resolve the theme's CSS tokens to rgb()
// via a hidden probe and let the terminal track the active light/dark palette.
// Shared by read-only reviewer terminal panes so they follow the same theme
// tokens.
export function readTerminalTheme(): ITheme {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const resolve = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const theme: ITheme = {
    background: resolve("--background"),
    foreground: resolve("--foreground"),
    cursor: resolve("--ring"),
    cursorAccent: resolve("--background"),
    selectionBackground: resolve("--accent"),
  };
  probe.remove();
  return theme;
}
