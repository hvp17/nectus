import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { appRepo, appTask } from "./appFixtures";

const mockedApi = vi.mocked(api);

// The app now boots into Mission Control (cross-project triage); the per-project
// kanban lives behind the "Board" rail button.
async function gotoBoard() {
  fireEvent.click(await screen.findByRole("button", { name: "Board" }));
}

export function defineAppSmokeTests() {
  it("boots into Mission Control", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeInTheDocument();
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("shows the connect-a-project board when there are no repos", async () => {
    render(<App />);

    await gotoBoard();

    expect(await screen.findByRole("heading", { name: /connect a project/i })).toBeInTheDocument();
  });

  it("ignores legacy demo query parameters and loads normal app data", async () => {
    window.history.pushState({}, "", "/?demo=1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeInTheDocument();
    expect(mockedApi.listRepos).toHaveBeenCalled();
    expect(mockedApi.listTasks).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Nectus Demo" })).not.toBeInTheDocument();
  });

  it("opens a task from Mission Control into a focused terminal workspace", async () => {
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

    expect(await screen.findByRole("region", { name: /agent workspace stage/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/task inspector/i)).toBeInTheDocument();
    expect(screen.getAllByText("feat/detail").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /back to task board/i }));

    expect(await screen.findByRole("heading", { name: "Mission Control" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /agent workspace stage/i })).not.toBeInTheDocument();
  });

  it("opens settings and saves appearance preferences", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Agent Profiles" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /projects & worktrees/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /dark/i }));
    fireEvent.click(screen.getByRole("radio", { name: /compact/i }));
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(mockedApi.updateAppSettings).toHaveBeenCalledWith({
        defaultAgentProfileId: 1,
        defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
        defaultBranchPrefix: null,
        jiraBoardJql: null,
        jiraSiteUrl: null,
        jiraBoardProject: null,
        jiraFilterMyIssues: false,
        jiraFilterUnresolved: true,
        jiraFilterCurrentSprint: false,
        jiraFilterStatuses: [],
        theme: "dark",
        density: "compact",
      });
    });
  });

  it("shows a connected JIRA token in Settings without first visiting the board", async () => {
    // REST status must load on mount, not when the JIRA board becomes active —
    // otherwise opening Settings directly shows a real Keychain token as
    // "Not connected" and hides the disconnect path.
    mockedApi.jiraRestStatus.mockResolvedValue({
      connected: true,
      site: "team.atlassian.net",
      email: "me@example.com",
      error: null,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByLabelText("JIRA REST Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(mockedApi.jiraSearchBoard).not.toHaveBeenCalled();
  });

  it("keeps jira_site_url fresh after connecting a token so a later save can't clobber it", async () => {
    // Connecting writes jira_site_url server-side; useApp must re-read settings so a
    // subsequent Save Settings re-sends the new site, not the stale one (which would
    // orphan the Keychain token and show REST as disconnected).
    const baseSettings = {
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
      defaultBranchPrefix: null,
      jiraBoardJql: null,
      jiraBoardProject: null,
      jiraFilterMyIssues: false,
      jiraFilterUnresolved: true,
      jiraFilterCurrentSprint: false,
      jiraFilterStatuses: [],
      theme: "system" as const,
      density: "comfortable" as const,
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    mockedApi.getAppSettings.mockReset();
    mockedApi.getAppSettings
      .mockResolvedValueOnce({ ...baseSettings, jiraSiteUrl: null, jiraRestEmail: null }) // mount
      .mockResolvedValue({
        // re-read after connecting reflects the server-side write
        ...baseSettings,
        jiraSiteUrl: "team.atlassian.net",
        jiraRestEmail: "me@example.com",
      });
    mockedApi.setJiraApiToken.mockResolvedValue({
      connected: true,
      site: "team.atlassian.net",
      email: "me@example.com",
      error: null,
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    fireEvent.change(screen.getByLabelText("Site"), { target: { value: "team.atlassian.net" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Test & connect" }));

    // Wait until the connect completed and settings were re-read.
    expect(await screen.findByLabelText("JIRA REST Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() =>
      expect(mockedApi.updateAppSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ jiraSiteUrl: "team.atlassian.net" }),
      ),
    );
  });

  it("does not render the temporary dummy notification preview on launch", async () => {
    render(<App />);

    await expect(screen.findByText("Notification truncation preview", undefined, { timeout: 100 })).rejects.toThrow();
  });
}
