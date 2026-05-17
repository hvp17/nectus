import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";

const mockedApi = vi.mocked(api);

export function defineAppSmokeTests() {
  it("renders the empty repo state", async () => {
    render(<App />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("ignores legacy demo query parameters and loads normal app data", async () => {
    window.history.pushState({}, "", "/?demo=1");

    render(<App />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(mockedApi.listRepos).toHaveBeenCalled();
    expect(mockedApi.listTasks).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Nectus Demo" })).not.toBeInTheDocument();
  });

  it("opens a selected task as a focused terminal workspace with an inspector sidebar", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Inspect task detail",
        hasWorktree: true,
        branchName: "feat/detail",
        worktreePath: "/tmp/nectus-desktop-worktrees/feat-detail",
      }),
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /inspect task detail/i }));

    const layout = screen.getByTestId("dashboard-layout");
    expect(layout).toHaveAttribute("data-task-workspace", "true");
    expect(screen.queryByRole("heading", { name: /task board/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /agent terminal/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/task inspector/i)).toBeInTheDocument();
    expect(screen.getByText("feat/detail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to task board/i }));

    expect(layout).toHaveAttribute("data-task-workspace", "false");
    expect(screen.getByRole("heading", { name: /task board/i })).toBeInTheDocument();
  });

  it("opens settings and saves appearance preferences", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));

    expect(screen.getByRole("heading", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText("Agent Profiles")).toBeInTheDocument();
    expect(screen.getByText("Projects & Worktrees")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /dark/i }));
    fireEvent.click(screen.getByRole("radio", { name: /compact/i }));
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(mockedApi.updateAppSettings).toHaveBeenCalledWith({
        defaultAgentProfileId: 1,
        defaultWorktreeRootPattern: "../{repoName}-worktrees",
        defaultBranchPrefix: null,
        theme: "dark",
        density: "compact",
      });
    });
  });

  it("does not render the temporary dummy notification preview on launch", async () => {
    render(<App />);

    await expect(screen.findByText("Notification truncation preview", undefined, { timeout: 100 })).rejects.toThrow();
  });
}
