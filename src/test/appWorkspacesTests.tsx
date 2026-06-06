import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";
import type { Repo, Workspace } from "../types";

const mockedApi = vi.mocked(api);

const secondRepo: Repo = {
  id: 8,
  name: "second-repo",
  path: "/tmp/second-repo",
  defaultWorktreeRoot: "/tmp/second-repo-worktrees",
  createdAt: "2026-05-14T00:00:00.000Z",
};

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 1,
    name: "First only",
    repoIds: [appRepo.id],
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

export function defineAppWorkspacesTests() {
  it("scopes Mission Control to the active workspace and back to all repos", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Task in first repo", activeSessionId: "s-101" }),
      appTask({ id: 102, repoId: secondRepo.id, title: "Task in second repo", activeSessionId: "s-102" }),
    ]);

    render(<App />);

    // "All repos" (the default) shows tasks from every project.
    expect(await screen.findByText("Task in first repo")).toBeInTheDocument();
    expect(screen.getByText("Task in second repo")).toBeInTheDocument();

    // Activating the workspace narrows Mission Control to its repos only.
    fireEvent.click(screen.getByText("First only"));
    await waitFor(() => {
      expect(screen.queryByText("Task in second repo")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Task in first repo")).toBeInTheDocument();

    // "All repos" clears the filter.
    fireEvent.click(screen.getByText("All repos"));
    expect(await screen.findByText("Task in second repo")).toBeInTheDocument();
  });

  it("creates a workspace from the manager with the chosen repos", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
    mockedApi.createWorkspace.mockResolvedValue(
      workspace({ id: 5, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage workspaces" }));

    expect(await screen.findByRole("region", { name: "Workspace manager" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Platform" } });
    fireEvent.click(screen.getByRole("switch", { name: appRepo.name }));
    fireEvent.click(screen.getByRole("switch", { name: secondRepo.name }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => {
      expect(mockedApi.createWorkspace).toHaveBeenCalledWith("Platform", [appRepo.id, secondRepo.id]);
    });
  });

  it("disables creating a workspace until at least one repo is selected", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage workspaces" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Naming only" } });

    // A name alone is not enough — an empty workspace would hide every project.
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: appRepo.name }));
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeEnabled();
    expect(mockedApi.createWorkspace).not.toHaveBeenCalled();
  });

  it("creates a cross-repo task from the workspace composer", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.createCrossRepoTask.mockResolvedValue(
      appTask({ id: 500, title: "Cross feature", branchName: "feat/cross", hasWorktree: true }),
    );

    render(<App />);

    // Activate the workspace, then open the board's New Task composer.
    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    // Cross-repo mode: a Repositories checklist with both repos pre-selected.
    const repoGroup = await screen.findByRole("group", { name: "Repositories" });
    const repoSwitches = within(repoGroup).getAllByRole("switch");
    expect(repoSwitches).toHaveLength(2);
    repoSwitches.forEach((toggle) => expect(toggle).toBeChecked());

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Cross feature" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createCrossRepoTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 1, repoIds: [appRepo.id, secondRepo.id] }),
      );
    });
    // It does NOT fall through to the single-repo create path.
    expect(mockedApi.createTask).not.toHaveBeenCalled();
  });

  it("edits an existing workspace's name and membership", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 3, name: "Frontend", repoIds: [appRepo.id] }),
    ]);
    mockedApi.updateWorkspace.mockResolvedValue(
      workspace({ id: 3, name: "Frontend+", repoIds: [appRepo.id, secondRepo.id] }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage workspaces" }));
    // Select the existing workspace to edit (its pill in the manager's edit group).
    const editPill = await screen.findByRole("button", { name: "Frontend" });
    fireEvent.click(editPill);
    // The selected edit target exposes its state to assistive tech.
    expect(editPill).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Frontend+" } });
    fireEvent.click(screen.getByRole("switch", { name: secondRepo.name }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedApi.updateWorkspace).toHaveBeenCalledWith(3, "Frontend+", [appRepo.id, secondRepo.id]);
    });
  });
}
