import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { RailView } from "./IconRail";

// The global ⌘K open/close shortcut now lives in useCommandPaletteShortcut (the
// palette is lazy-mounted only while open); its tests live alongside that hook.

function renderPalette({
  open = false,
  onOpenChange = vi.fn(),
  onNavigate = vi.fn<(view: RailView) => void>(),
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigate?: (view: RailView) => void;
} = {}) {
  render(
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      repos={[]}
      workspaces={[]}
      tasks={[]}
      canCreateTask={false}
      onNavigate={onNavigate}
      onOpenProject={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onOpenTask={vi.fn()}
      onCreateTask={vi.fn()}
    />,
  );
  return { onNavigate, onOpenChange };
}

describe("CommandPalette", () => {
  afterEach(() => vi.clearAllMocks());

  it("closes before running a selected command", () => {
    const onNavigate = vi.fn<(view: RailView) => void>();
    const onOpenChange = vi.fn();
    renderPalette({ open: true, onNavigate, onOpenChange });

    fireEvent.click(screen.getByText("Settings"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(onNavigate.mock.invocationCallOrder[0]);
  });
});
