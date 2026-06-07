import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";
import type { Repo, Workspace } from "../types";

const mockedApi = vi.mocked(api);

const secondRepo: Repo = {
  id: 8, name: "second-repo", path: "/tmp/second-repo",
  defaultWorktreeRoot: "/tmp/second-repo-worktrees", createdAt: "2026-05-14T00:00:00.000Z",
};

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: 1, name: "Core", repoIds: [appRepo.id, secondRepo.id], createdAt: "x", updatedAt: "x", ...overrides };
}

export function defineAppSidebarTests() {
  it("lists projects and workspaces with active-agent counts in the persistent panel", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({ id: 101, repoId: appRepo.id, title: "Running here", activeSessionId: "s-101" }),
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

  it("the workspace info card lists its projects", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo, secondRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace()]);
    mockedApi.listTasks.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Projects in Core" }));
    const card = await screen.findByText(secondRepo.name, { selector: ".nx-info-row" });
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

  it("Mission Control no longer renders the workspace scope switcher", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listWorkspaces.mockResolvedValue([workspace({ repoIds: [appRepo.id] })]);

    render(<App />);
    await screen.findByRole("heading", { name: "Mission Control" });
    // "All repos" was the switcher's clear-filter pill; it must be gone.
    expect(screen.queryByRole("radio", { name: "All repos" })).not.toBeInTheDocument();
    expect(screen.queryByText("All repos")).not.toBeInTheDocument();
  });
}
