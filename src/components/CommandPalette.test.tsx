import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { RailView } from "./IconRail";

function dispatchShortcut(init: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
  const event = new KeyboardEvent("keydown", {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function renderPalette({
  open = false,
  onOpenChange = vi.fn(),
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  render(
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      repos={[]}
      workspaces={[]}
      tasks={[]}
      canCreateTask={false}
      onNavigate={vi.fn<(view: RailView) => void>()}
      onOpenProject={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onOpenTask={vi.fn()}
      onCreateTask={vi.fn()}
    />,
  );
  return { onOpenChange };
}

describe("CommandPalette", () => {
  afterEach(() => vi.clearAllMocks());

  it("opens on the Cmd+K shortcut and prevents the browser default", () => {
    const { onOpenChange } = renderPalette();

    const event = dispatchShortcut({ key: "k", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("closes on the Ctrl+K shortcut when already open", () => {
    const { onOpenChange } = renderPalette({ open: true });

    const event = dispatchShortcut({ key: "K", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores unrelated keydown events", () => {
    const { onOpenChange } = renderPalette();

    const event = dispatchShortcut({ key: "j", metaKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
