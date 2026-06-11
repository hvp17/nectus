import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { formatNotificationBody } from "../notificationText";
import { useAppStore } from "../store/appStore";
import type { TaskSummary } from "../types";
import { appRepo, appTask } from "./appFixtures";
import { deferred } from "./testUtils";

const mockedApi = vi.mocked(api);

function mockProject() {
  mockedApi.listRepos.mockResolvedValue([appRepo]);
}

// The "New Task" action lives on the per-project board (the app boots into Mission
// Control). Open the board, then the inline composer view.
async function openCreateTaskModal() {
  fireEvent.click(await screen.findByRole("button", { name: "Board" }));
  fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
  await screen.findByRole("heading", { name: "New Task" });
}

// The composer uses Selects for project/agent and a Switch for the worktree.
async function selectAgent(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: "Agent" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

function setWorktree(on: boolean) {
  const toggle = screen.getByRole("switch", { name: /worktree/i });
  if ((toggle.getAttribute("aria-checked") === "true") !== on) {
    fireEvent.click(toggle);
  }
}

function createTaskMock(title: string, overrides = {}) {
  mockedApi.createTask.mockResolvedValue(
    appTask({
      id: 11,
      title,
      agentProfileId: 2,
      agentName: "Claude",
      agentKind: "claude",
      ...overrides,
    }),
  );
}

export function defineAppTaskCreationTests() {
  it("opens the New Task composer from the board", async () => {
    mockProject();

    render(<App />);

    await openCreateTaskModal();

    expect(screen.getByRole("heading", { name: "New Task" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /new task composer/i })).toBeInTheDocument();
  });

  it("opens the New Task composer from the icon rail, available from any view", async () => {
    mockProject();

    render(<App />);

    // The rail's create action lives outside the board, so it works from Mission
    // Control (the boot view) and from an open task's terminal alike.
    const createFromRail = await screen.findByRole("button", { name: "Create task" });
    await waitFor(() => expect(createFromRail).toBeEnabled());
    fireEvent.click(createFromRail);

    expect(await screen.findByRole("heading", { name: "New Task" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /new task composer/i })).toBeInTheDocument();
  });

  it("renders one brand logo per agent choice", async () => {
    mockProject();

    render(<App />);

    await openCreateTaskModal();

    fireEvent.click(screen.getByRole("combobox", { name: "Agent" }));
    const options = await screen.findAllByRole("option");
    const logos = options.flatMap((option) => within(option).queryAllByRole("img", { name: /logo/i }));
    expect(logos.map((logo) => logo.getAttribute("aria-label"))).toEqual([
      "Codex logo",
      "Claude logo",
      "OpenCode logo",
    ]);
  });

  it("opens a task modal and creates a task with an optional title, selected agent, prompt, and worktree choice", async () => {
    mockProject();
    createTaskMock("Review modal task flow");

    render(<App />);

    await openCreateTaskModal();

    expect(screen.getByRole("heading", { name: "New Task" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: "Review modal task flow" },
    });
    await selectAgent(/claude/i);
    setWorktree(false);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Review modal task flow",
        prompt: "Review modal task flow",
        agentProfileId: 2,
        hasWorktree: false,
        branchName: null,
        jiraIssueKey: null,
        jiraIssueSummary: null,
        jiraIssueUrl: null,
      });
    });
  });

  it("opens the task modal from the board's New Task action", async () => {
    mockProject();
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Keep terminal handy",
        activeSessionId: "session-31",
      }),
    ]);

    render(<App />);

    await openCreateTaskModal();

    expect(screen.getByRole("heading", { name: "New Task" })).toBeInTheDocument();
  });

  it("creates a task when instructions are blank", async () => {
    mockProject();
    createTaskMock("Create title-only task", {
      id: 12,
      title: "Create title-only task",
      prompt: null,
      agentProfileId: 1,
      agentName: "Codex",
      agentKind: "codex",
    });

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create title-only task" },
    });

    const createButton = screen.getByRole("button", { name: /create & start/i });
    expect(createButton).toBeEnabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Create title-only task",
        prompt: null,
        agentProfileId: 1,
        hasWorktree: false,
        branchName: null,
        jiraIssueKey: null,
        jiraIssueSummary: null,
        jiraIssueUrl: null,
      });
    });
  });

  it("replaces a stale draft agent when opening the New Task composer", async () => {
    mockProject();
    useAppStore.setState({ newTaskAgentProfileId: 99 });
    createTaskMock("Create with resolved agent", {
      agentProfileId: 1,
      agentName: "Codex",
      agentKind: "codex",
    });

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create with resolved agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Create with resolved agent",
        prompt: null,
        agentProfileId: 1,
        hasWorktree: false,
        branchName: null,
        jiraIssueKey: null,
        jiraIssueSummary: null,
        jiraIssueUrl: null,
      });
    });
  });

  it("automatically starts the selected agent after creating a task with instructions", async () => {
    mockProject();
    createTaskMock("Review modal task flow", { prompt: "Review modal task flow" });

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: "Review modal task flow" },
    });
    await selectAgent(/claude/i);
    setWorktree(false);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Review modal task flow",
        prompt: "Review modal task flow",
        agentProfileId: 2,
        hasWorktree: false,
        branchName: null,
        jiraIssueKey: null,
        jiraIssueSummary: null,
        jiraIssueUrl: null,
      });
    });
    await waitFor(() => {
      expect(mockedApi.startSession).toHaveBeenCalledWith(11, 2);
    });
  });

  it("generates a worktree branch identifier when the branch name is blank", async () => {
    mockProject();
    createTaskMock("Create generated branch", {
      hasWorktree: true,
      branchName: "task-generated",
      worktreePath: "/tmp/nectus-desktop-worktrees/task-generated",
    });

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create generated branch" },
    });
    setWorktree(true);

    const branchInput = screen.getByLabelText(/branch name/i);
    fireEvent.change(branchInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          hasWorktree: true,
          branchName: expect.stringMatching(/^task-[a-z0-9-]+$/),
        }),
      );
    });
  });

  it("appends a generated worktree identifier when the branch name only contains the default prefix", async () => {
    mockProject();
    mockedApi.getAppSettings.mockResolvedValue({
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
      defaultBranchPrefix: "feat/",
      jiraBoardJql: null,
      jiraSiteUrl: null,
      jiraBoardProject: null,
      jiraFilterMyIssues: false,
      jiraFilterUnresolved: true,
      jiraFilterCurrentSprint: false,
      jiraFilterStatuses: [],
      persistentSessions: false,
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    createTaskMock("Create prefixed branch", {
      hasWorktree: true,
      branchName: "feat/task-generated",
      worktreePath: "/tmp/nectus-desktop-worktrees/feat/task-generated",
    });

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create prefixed branch" },
    });
    setWorktree(true);
    const branchInput = screen.getByLabelText(/branch name/i);
    const suggestedBranchName = branchInput.getAttribute("placeholder");

    expect(suggestedBranchName).toMatch(/^feat\/task-[a-z0-9-]+$/);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          hasWorktree: true,
          branchName: suggestedBranchName,
        }),
      );
    });
  });

  it("shows the generated prefixed worktree branch as the branch placeholder", async () => {
    mockProject();
    mockedApi.getAppSettings.mockResolvedValue({
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
      defaultBranchPrefix: "feat/",
      jiraBoardJql: null,
      jiraSiteUrl: null,
      jiraBoardProject: null,
      jiraFilterMyIssues: false,
      jiraFilterUnresolved: true,
      jiraFilterCurrentSprint: false,
      jiraFilterStatuses: [],
      persistentSessions: false,
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });

    render(<App />);

    await openCreateTaskModal();
    setWorktree(true);

    const branchInput = screen.getByLabelText(/branch name/i);
    const placeholder = branchInput.getAttribute("placeholder");

    expect(branchInput).toHaveValue("");
    expect(placeholder).toMatch(/^feat\/task-[a-z0-9-]+$/);
    expect(placeholder).not.toBe("feat/task-identifier");
  });

  it("dismisses the toast when the close button is clicked", async () => {
    mockProject();
    createTaskMock("Review modal task flow");

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: "Review modal task flow" },
    });
    await selectAgent(/claude/i);
    setWorktree(false);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    const createdToastBody = await screen.findByText("Created Review modal task flow");
    const createdToast = createdToastBody.closest("[data-sonner-toast]");
    expect(createdToast).toBeInTheDocument();

    fireEvent.click(within(createdToast as HTMLElement).getByRole("button", { name: /close toast/i }));

    await waitFor(() => {
      expect(screen.queryByText("Created Review modal task flow")).not.toBeInTheDocument();
    });
  });

  it("renders truncated notification text in a sonner toast", async () => {
    const longTaskTitle =
      "Review a long running agent summary that explains the final state, the important changed files, and the next manual verification steps";

    mockProject();
    createTaskMock(longTaskTitle);

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: longTaskTitle },
    });
    await selectAgent(/claude/i);
    setWorktree(false);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));

    const toastBody = await screen.findByText(formatNotificationBody(`Created ${longTaskTitle}`));

    expect(toastBody.closest("[data-sonner-toast]")).toHaveClass("cn-toast");
  });

  it("automatically dismisses alerts after 5 seconds", async () => {
    const creation = deferred<TaskSummary>();
    const createdTask = appTask({
      id: 41,
      title: "Review modal task flow",
      prompt: "Review modal task flow",
      agentProfileId: 2,
      agentName: "Claude",
      agentKind: "claude",
    });
    mockProject();
    mockedApi.createTask.mockReturnValue(creation.promise);

    render(<App />);

    await openCreateTaskModal();
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: "Review modal task flow" },
    });
    await selectAgent(/claude/i);
    setWorktree(false);
    fireEvent.click(screen.getByRole("button", { name: /create & start/i }));
    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalled();
    });

    vi.useFakeTimers();
    await act(async () => {
      creation.resolve(createdTask);
      await creation.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Created Review modal task flow")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(screen.getByText("Created Review modal task flow")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText("Created Review modal task flow")).not.toBeInTheDocument();
  });
}
