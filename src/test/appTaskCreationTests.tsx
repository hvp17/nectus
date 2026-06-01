import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { formatNotificationBody } from "../notificationText";
import type { TaskSummary } from "../types";
import { appRepo, appTask } from "./appFixtures";
import { deferred } from "./testUtils";

const mockedApi = vi.mocked(api);

function mockProject() {
  mockedApi.listRepos.mockResolvedValue([appRepo]);
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
  it("opens the task modal at the larger setup width", async () => {
    mockProject();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-3xl");
  });

  it("renders one brand logo per agent choice", async () => {
    mockProject();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    const dialog = screen.getByRole("dialog");
    const logos = within(dialog).getAllByRole("img", { name: /logo/i });
    expect(logos).toHaveLength(2);
    expect(logos.map((logo) => logo.getAttribute("aria-label"))).toEqual(["Codex logo", "Claude logo"]);
  });

  it("opens a task modal and creates a task with an optional title, selected agent, prompt, and worktree choice", async () => {
    mockProject();
    createTaskMock("Review modal task flow");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Review modal task flow",
        prompt: "Review modal task flow",
        agentProfileId: 2,
        hasWorktree: false,
        branchName: null,
      });
    });
  });

  it("opens the task modal from a project's add-task action", async () => {
    mockProject();
    mockedApi.listTasks.mockResolvedValue([
      appTask({
        id: 31,
        title: "Keep terminal handy",
        activeSessionId: "session-31",
      }),
    ]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /add task to nectus-desktop/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create title-only task" },
    });

    const createButton = screen.getByRole("button", { name: /^create task$/i });
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
      });
    });
  });

  it("automatically starts the selected agent after creating a task with instructions", async () => {
    mockProject();
    createTaskMock("Review modal task flow", { prompt: "Review modal task flow" });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

    await waitFor(() => {
      expect(mockedApi.createTask).toHaveBeenCalledWith({
        repoId: appRepo.id,
        title: "Review modal task flow",
        prompt: "Review modal task flow",
        agentProfileId: 2,
        hasWorktree: false,
        branchName: null,
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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create generated branch" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /new worktree/i }));

    const branchInput = screen.getByLabelText(/branch name/i);
    fireEvent.change(branchInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

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
      defaultWorktreeRootPattern: "../{repoName}-worktrees",
      defaultBranchPrefix: "feat/",
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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Create prefixed branch" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /new worktree/i }));
    const branchInput = screen.getByLabelText(/branch name/i);
    const suggestedBranchName = branchInput.getAttribute("placeholder");

    expect(suggestedBranchName).toMatch(/^feat\/task-[a-z0-9-]+$/);
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

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
      defaultWorktreeRootPattern: "../{repoName}-worktrees",
      defaultBranchPrefix: "feat/",
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.click(screen.getByRole("radio", { name: /new worktree/i }));

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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: longTaskTitle },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));

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

    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText(/instructions/i), {
      target: { value: "Review modal task flow" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /claude/i }));
    fireEvent.click(screen.getByRole("radio", { name: /direct edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));
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
