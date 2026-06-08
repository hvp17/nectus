import { afterEach, describe, expect, it, vi } from "vitest";
import { readTerminalTheme } from "./terminalTheme";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readTerminalTheme", () => {
  it("resolves terminal colors from CSS tokens and removes its probe", () => {
    const colors: Record<string, string> = {
      "var(--background)": "rgb(250, 250, 250)",
      "var(--foreground)": "rgb(20, 20, 20)",
      "var(--ring)": "rgb(80, 90, 100)",
      "var(--accent)": "rgb(220, 230, 240)",
    };
    const getComputedStyleMock = vi.fn((element: Element) => {
      const color = colors[(element as HTMLElement).style.color] ?? "";
      return { color } as CSSStyleDeclaration;
    });
    vi.stubGlobal("getComputedStyle", getComputedStyleMock);

    const childrenBefore = document.body.childElementCount;
    const theme = readTerminalTheme();

    expect(theme).toEqual({
      background: "rgb(250, 250, 250)",
      foreground: "rgb(20, 20, 20)",
      cursor: "rgb(80, 90, 100)",
      cursorAccent: "rgb(250, 250, 250)",
      selectionBackground: "rgb(220, 230, 240)",
    });
    expect(getComputedStyleMock).toHaveBeenCalledTimes(5);
    expect(document.body.childElementCount).toBe(childrenBefore);
  });
});
