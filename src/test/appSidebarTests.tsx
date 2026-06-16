import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";
import type { Repo, Workspace } from "../types";

const mockedApi = vi.mocked(api);

const secondRepo: Repo = {
  id: 8, name: "second-repo", path: "/tmp/second-repo",
  defaultWorktreeRoot: "/tmp/second-repo-worktrees", createdAt: "2026-05-14T00:00:00.000Z", collapsed: false,
};

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: 1, name: "Core", repoIds: [appRepo.id, secondRepo.id], createdAt: "x", updatedAt: "x", collapsed: false, ...overrides };
}

export function defineAppSidebarTests() {
  it("lists projects and workspaces with active-agent counts in the persistent panel", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Running here", status: "review" }),
    ]);

    render(<App />);

    const panel = await screen.findByRole("complementary", { name: "Projects and workspaces" });
    // Project row shows its name (in the nav button) and its one active agent nested under it.
    expect(within(panel).getAllByText(appRepo.name).length).toBeGreaterThan(0);
    // The agent row surfaces under the project and under its workspace — at least one must be present.
    expect(within(panel).getAllByRole("button", { name: /Open Running here/ }).length).toBeGreaterThan(0);
    // Workspace section lists the workspace.
    expect(within(panel).getByText("Core")).toBeInTheDocument();
  });

  it("folds a project's nested agents from the chevron and persists the preference", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Running here", status: "review" }),
    ]);

    render(<App />);

    const panel = await screen.findByRole("complementary", { name: "Projects and workspaces" });
    // The nested agent is visible while the row is expanded.
    expect(within(panel).getByRole("button", { name: /Open Running here/ })).toBeInTheDocument();

    // Collapsing folds the agent away and persists the fold.
    fireEvent.click(within(panel).getByRole("button", { name: `Collapse agents in ${appRepo.name}` }));
    await waitFor(() =>
      expect(within(panel).queryByRole("button", { name: /Open Running here/ })).not.toBeInTheDocument(),
    );
    expect(mockedApi.setRepoCollapsed).toHaveBeenCalledWith(appRepo.id, true);

    // The control now offers to expand again, and clicking it brings the agent back.
    fireEvent.click(within(panel).getByRole("button", { name: `Expand agents in ${appRepo.name}` }));
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: /Open Running here/ })).toBeInTheDocument(),
    );
    expect(mockedApi.setRepoCollapsed).toHaveBeenLastCalledWith(appRepo.id, false);
  });

  it("the workspace info card lists its projects", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Projects in Core" }));
    const card = await screen.findByText(secondRepo.name, { selector: '[data-testid="workspace-info-repo"]' });
    expect(card).toBeInTheDocument();
  });

  it("hides the panel on Settings", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);

    render(<App />);
    expect(await screen.findByRole("complementary", { name: "Projects and workspaces" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("complementary", { name: "Projects and workspaces" })).not.toBeInTheDocument();
  });

  it("keeps the projects/workspaces navigator visible in task details", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
    mockedApi.listTasks.mockResolvedValue([appTask({ id: 55, repoId: appRepo.id, title: "Open me" })]);

    render(<App />);

    // Open the task from the project board.
    fireEvent.click(await screen.findByRole("button", { name: "Board" }));
    const board = await screen.findByTestId("dashboard-layout");
    fireEvent.click(within(board).getByRole("button", { name: /Open me/ }));

    // The task workspace is shown AND the navigator panel stays visible beside it.
    const taskView = await screen.findByTestId("dashboard-layout");
    expect(taskView).toHaveAttribute("data-task-workspace", "true");
    expect(screen.getByRole("complementary", { name: "Projects and workspaces" })).toBeInTheDocument();
  });

  it("Mission Control no longer renders the workspace scope switcher", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace({ repoIds: [appRepo.id] })]);

    render(<App />);
    await screen.findByRole("heading", { name: "Mission Control" });
    // "All repos" was the switcher's clear-filter pill; it must be gone.
    expect(screen.queryByRole("radio", { name: "All repos" })).not.toBeInTheDocument();
    expect(screen.queryByText("All repos")).not.toBeInTheDocument();
  });

  it("opens the composer preselected to a project from its sidebar + button", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
    mockedApi.listTasks.mockResolvedValue([]);
    mockedApi.createTask.mockResolvedValue(appTask({ id: 80, repoId: secondRepo.id, title: "From sidebar" }));

    render(<App />);

    // Each project row exposes a hover "+"; click the second repo's (not the default first).
    fireEvent.click(await screen.findByRole("button", { name: `Add task to ${secondRepo.name}` }));
    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();

    // The preselected project is the one whose + was clicked, so creating targets it.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "From sidebar" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ repoId: secondRepo.id }));
    });
  });

  it("opens the composer in cross-repo mode preselected to a workspace from its + button", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([
      workspace({ id: 5, name: "Platform", repoIds: [appRepo.id, secondRepo.id] }),
    ]);
    mockedApi.listTasks.mockResolvedValue([]);
    mockedApi.createCrossRepoTask.mockResolvedValue(
      appTask({ id: 500, title: "WS task", branchName: "feat/x", hasWorktree: true }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Add task to Platform" }));
    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();

    // A ≥2-repo workspace opens in Workspace scope with both members pre-checked.
    expect(screen.getByRole("radio", { name: "Workspace scope" })).toBeChecked();
    const repoSwitches = within(screen.getByRole("group", { name: "Repositories" })).getAllByRole("switch");
    expect(repoSwitches).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "WS task" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createCrossRepoTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 5, repoIds: [appRepo.id, secondRepo.id] }),
      );
    });
    expect(mockedApi.createTask).not.toHaveBeenCalled();
  });

  it("falls back to Project mode preselected to a single-repo workspace's member", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    // A 1-repo workspace can't fan out, so its + opens single-repo Project mode on that member.
    mockedApi.listWorkspaces.mockResolvedValue([workspace({ id: 6, name: "Solo", repoIds: [secondRepo.id] })]);
    mockedApi.listTasks.mockResolvedValue([]);
    mockedApi.createTask.mockResolvedValue(appTask({ id: 60, repoId: secondRepo.id, title: "Solo task" }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Add task to Solo" }));
    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Repositories" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Solo task" } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(expect.objectContaining({ repoId: secondRepo.id }));
    });
  });
}
