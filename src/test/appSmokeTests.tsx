import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows active session tasks above settings and opens them from the sidebar", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Keep terminal handy",
        status: "in_progress",
        activeSessionId: "session-31",
        hasWorktree: true,
        branchName: "feat/sidebar-session",
      }),
      appTask({
        id: 32,
        title: "No live process",
        activeSessionId: null,
      }),
    ]);

    render(<App />);

    const panel = await screen.findByRole("region", { name: /tasks quick access/i });
    const settingsButton = screen.getByRole("button", { name: /settings/i });
    expect(panel.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).getByText("Keep terminal handy")).toBeInTheDocument();
    expect(within(panel).queryByText("No live process")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /open keep terminal handy/i }));

    expect(await screen.findByRole("region", { name: /agent terminal/i })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-layout")).toHaveAttribute("data-task-workspace", "true");
  });

  it("stops an active session from the sidebar quick access panel", async () => {
    mockedApi.listRepos.mockResolvedValue([appRepo]);
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Stop from sidebar",
        activeSessionId: "session-31",
      }),
    ]);
    mockedApi.stopSession.mockResolvedValue({
      id: "session-31",
      resumableSessionId: "resume-31",
      resumableSessionLabel: "Stop from sidebar",
      taskId: 31,
      agentProfileId: 1,
      state: "stopped",
      pid: null,
      startedAt: "2026-05-17T12:00:00.000Z",
      stoppedAt: "2026-05-17T12:05:00.000Z",
    });

    render(<App />);

    const panel = await screen.findByRole("region", { name: /tasks quick access/i });
    fireEvent.click(within(panel).getByRole("button", { name: /stop stop from sidebar/i }));

    await waitFor(() => {
      expect(mockedApi.stopSession).toHaveBeenCalledWith("session-31");
    });
    await waitFor(() => {
      const panel = screen.getByRole("region", { name: /tasks quick access/i });
      expect(within(panel).getByText("1")).toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: /stop stop from sidebar/i })).not.toBeInTheDocument();
    });
  });

  it("does not render the temporary dummy notification preview on launch", async () => {
    render(<App />);

    await expect(screen.findByText("Notification truncation preview", undefined, { timeout: 100 })).rejects.toThrow();
  });
}
