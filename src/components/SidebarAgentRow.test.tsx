import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarAgentRow } from "./SidebarAgentRow";
import type { AgentRow } from "../lib/agentState";
import { appTask } from "../test/appFixtures";

function makeRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    task: appTask(),
    state: "running",
    line: "Working on it",
    elapsed: "2m",
    repoName: "nectus-desktop",
    ...overrides,
  };
}

describe("SidebarAgentRow", () => {
  it("wraps the line in curly quotes for a needs_you row", () => {
    const row = makeRow({ state: "needs_you", line: "What should I do?" });
    render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    // The component wraps the line in Unicode typographic curly quotes (“ and ”)
    expect(screen.getByText("“What should I do?”")).toBeInTheDocument();
  });

  it("renders the live pulse dot for a running row", () => {
    const row = makeRow({ state: "running", line: "Compiling…" });
    const { container } = render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="live-dot"]')).toBeInTheDocument();
  });

  it("does not render the live pulse dot for a non-running row", () => {
    const row = makeRow({ state: "needs_you", line: "Answer me" });
    const { container } = render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="live-dot"]')).not.toBeInTheDocument();
  });

  it("does not quote the line for a non-needs_you row", () => {
    const row = makeRow({ state: "running", line: "Building project" });
    render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    expect(screen.getByText("Building project")).toBeInTheDocument();
    expect(screen.queryByText("“Building project”")).not.toBeInTheDocument();
  });

  it("does not render the branch name when hasWorktree is false", () => {
    const task = appTask({ hasWorktree: false, branchName: "feat/some-branch" });
    const row = makeRow({ task });
    const { container } = render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="agent-branch"]')).not.toBeInTheDocument();
  });

  it("renders the branch name when hasWorktree is true and branchName is set", () => {
    const task = appTask({ hasWorktree: true, branchName: "feat/my-feature" });
    const row = makeRow({ task });
    const { container } = render(<SidebarAgentRow row={row} onOpen={vi.fn()} />);
    expect(container.querySelector('[data-testid="agent-branch"]')).toBeInTheDocument();
    expect(screen.getByText("feat/my-feature")).toBeInTheDocument();
  });
});
