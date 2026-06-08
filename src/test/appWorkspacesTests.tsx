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
  collapsed: false,
};

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 1,
    name: "First only",
    repoIds: [appRepo.id],
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    collapsed: false,
    ...overrides,
  };
}

export function defineAppWorkspacesTests() {
  it("opens a workspace board aggregating tasks from its repos, with repo badges", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Task in first repo" }),
      appTask({ id: 102, repoId: secondRepo.id, title: "Task in second repo" }),
    ]);

    render(<App />);

    // The Workspaces section row opens the aggregated board.
    fireEvent.click(await screen.findByText("Platform"));

    const board = await screen.findByTestId("workspace-board");
    expect(within(board).getByText("Task in first repo")).toBeInTheDocument();
    expect(within(board).getByText("Task in second repo")).toBeInTheDocument();
    // Cards carry their project name as a repo badge.
    expect(within(board).getByText(secondRepo.name)).toBeInTheDocument();
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

    // Open the Platform workspace board, then its New Task composer (cross-repo context).
    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(await within(await screen.findByTestId("workspace-board")).findByRole("button", { name: /new task/i }));

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

  it("selecting one repo in the workspace composer creates a worktree task on that repo", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.createTask.mockResolvedValue(appTask({ id: 600, title: "Solo in workspace" }));

    render(<App />);
    // Open the Platform workspace board, then its New Task composer (cross-repo context).
    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(await within(await screen.findByTestId("workspace-board")).findByRole("button", { name: /new task/i }));

    // Deselect the primary/board repo (appRepo), leaving only the second.
    const repoGroup = await screen.findByRole("group", { name: "Repositories" });
    fireEvent.click(within(repoGroup).getByRole("switch", { name: appRepo.name }));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Solo in workspace" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    // It uses the PICKED repo (a worktree task), not the board-selected repo, and
    // does not fan out a cross-repo task.
    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ repoId: secondRepo.id, hasWorktree: true }),
      );
    });
    expect(mockedApi.createCrossRepoTask).not.toHaveBeenCalled();
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

  it("hides the composer scope toggle when no workspace resolves to ≥2 repos", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    // A 1-repo workspace is functionally a project, so it does not enable the toggle.
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 1, name: "Solo", repoIds: [appRepo.id] }),
    ]);

    render(<App />);

    // Open the composer from the icon rail (a project context, not a workspace board).
    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();

    expect(screen.queryByRole("radio", { name: "Workspace scope" })).not.toBeInTheDocument();
    // It stays in single-repo Project mode.
    expect(screen.getByRole("combobox", { name: "Project" })).toBeInTheDocument();
  });

  it("switches to Workspace scope from a project context and creates a cross-repo task", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 7, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.createCrossRepoTask.mockResolvedValue(
      appTask({ id: 700, title: "Cross from rail", branchName: "feat/cross", hasWorktree: true }),
    );

    render(<App />);

    // Open from the icon rail: no workspace board is focused, so it defaults to Project.
    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Project scope" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Project" })).toBeInTheDocument();

    // Flip to Workspace scope; the cross-repo checklist appears, pre-filled with both repos.
    fireEvent.click(screen.getByRole("radio", { name: "Workspace scope" }));
    const repoGroup = await screen.findByRole("group", { name: "Repositories" });
    const repoSwitches = within(repoGroup).getAllByRole("switch");
    expect(repoSwitches).toHaveLength(2);
    repoSwitches.forEach((toggle) => expect(toggle).toBeChecked());

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Cross from rail" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createCrossRepoTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 7, repoIds: [appRepo.id, secondRepo.id] }),
      );
    });
    expect(mockedApi.createTask).not.toHaveBeenCalled();
  });

  it("defaults to Workspace scope from a workspace board and can switch back to Project", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 9, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.createTask.mockResolvedValue(appTask({ id: 900, title: "Back to single" }));

    render(<App />);

    fireEvent.click(await screen.findByText("Platform"));
    fireEvent.click(await within(await screen.findByTestId("workspace-board")).findByRole("button", { name: /new task/i }));

    // Opened from the board → Workspace scope is the default, checklist visible.
    expect(await screen.findByRole("radio", { name: "Workspace scope" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Repositories" })).toBeInTheDocument();

    // Switch to Project: the single-repo Project select returns, checklist disappears.
    fireEvent.click(screen.getByRole("radio", { name: "Project scope" }));
    expect(await screen.findByRole("combobox", { name: "Project" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Repositories" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Back to single" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    // The primary board repo is the single-repo target; no cross-repo fan-out.
    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ repoId: appRepo.id }),
      );
    });
    expect(mockedApi.createCrossRepoTask).not.toHaveBeenCalled();
  });
}
