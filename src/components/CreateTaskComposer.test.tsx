import type { FormEvent } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateTaskComposer } from "./CreateTaskComposer";
import type { AgentProfile, Repo, Workspace } from "../types";

const repo = (id: number, name: string): Repo => ({
  id,
  name,
  path: `/repos/${name}`,
  defaultWorktreeRoot: `/worktrees/${name}`,
  createdAt: "2026-06-09T00:00:00.000Z",
  collapsed: false,
});

const profile: AgentProfile = {
  id: 1,
  name: "Codex",
  agentKind: "codex",
  command: "codex",
  model: null,
  args: [],
  env: {},
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

const workspace: Workspace = {
  id: 10,
  name: "Platform",
  repoIds: [1, 2],
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  collapsed: false,
};

const repos = [repo(1, "api"), repo(2, "web")];

function baseProps(onSetRepoIds = vi.fn()) {
  return {
    onClose: vi.fn(),
    onSubmit: vi.fn((event: FormEvent) => event.preventDefault()),
    agentProfiles: [profile],
    repos,
    busy: false,
    newTaskTitle: "",
    setNewTaskTitle: vi.fn(),
    newTaskPrompt: "",
    setNewTaskPrompt: vi.fn(),
    newTaskBranchName: "",
    setNewTaskBranchName: vi.fn(),
    newTaskHasWorktree: true,
    setNewTaskHasWorktree: vi.fn(),
    suggestedBranchName: "task-platform",
    newTaskAgentProfileId: profile.id,
    setNewTaskAgentProfileId: vi.fn(),
    newTaskRepoId: 1,
    setNewTaskRepoId: vi.fn(),
    workspaces: [],
    newTaskWorkspaceId: workspace.id,
    setNewTaskWorkspaceId: vi.fn(),
    selectedRepoIds: [],
    onSetRepoIds,
  };
}

describe("CreateTaskComposer", () => {
  it("seeds the focused workspace repos when workspace data arrives after mount", async () => {
    const onSetRepoIds = vi.fn();
    const props = baseProps(onSetRepoIds);
    const { rerender } = render(<CreateTaskComposer {...props} />);

    expect(onSetRepoIds).not.toHaveBeenCalled();

    rerender(<CreateTaskComposer {...props} workspaces={[workspace]} />);

    await waitFor(() => expect(onSetRepoIds).toHaveBeenCalledWith([1, 2]));
  });
});
