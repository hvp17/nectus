import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openExternal } from "../lib/openExternal";
import type { TaskAttention } from "../sessionAttention";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { AgentProfile, GithubStatus, PullRequestInfo, ReviewLoop, ReviewRun, TaskSummary } from "../types";
import { TaskWorkspace } from "./TaskWorkspace";

vi.mock("../lib/openExternal", () => ({ openExternal: vi.fn() }));

const mockedOpenExternal = vi.mocked(openExternal);

beforeEach(() => {
  mockedOpenExternal.mockClear();
});

const task: TaskSummary = {
  id: 42,
  repoId: 7,
  title: "Finished task with long output",
  prompt: "Check the final agent output.",
  status: "done",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/card-ellipsis",
  worktreePath: "/tmp/nectus-worktrees/feat-card-ellipsis",
  isDirty: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

const agentProfiles: AgentProfile[] = [
  {
    id: 1,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Claude Review",
    agentKind: "claude",
    command: "claude",
    model: null,
    args: ["--print"],
    env: {},
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
  {
    id: 3,
    name: "Gemini",
    agentKind: "gemini",
    command: "gemini",
    model: null,
    args: [],
    env: {},
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
];

function renderTaskWorkspace(input?: {
  task?: TaskSummary;
  attention?: TaskAttention;
  reviewLoop?: ReviewLoop | null;
  reviewRuns?: ReviewRun[];
  liveReviewOutput?: string;
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  onStopSession?: (sessionId: string) => void;
  onResumeSession?: (task: TaskSummary) => void;
  onStartSession?: (task: TaskSummary) => void;
  onStartReview?: (task: TaskSummary, reviewerProfileId: number) => void;
  onCreatePullRequest?: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onRefreshPullRequest?: (task: TaskSummary) => void;
  onUpdateStatus?: (task: TaskSummary, status: TaskSummary["status"]) => void;
  onDeleteTask?: (task: TaskSummary) => void;
}) {
  return renderWithTooltipProvider(
    <TaskWorkspace
      task={input?.task ?? task}
      attention={input?.attention}
      agentProfiles={agentProfiles}
      reviewLoop={input?.reviewLoop ?? null}
      reviewRuns={input?.reviewRuns ?? []}
      liveReviewOutput={input?.liveReviewOutput}
      githubStatus={input?.githubStatus}
      pullRequest={input?.pullRequest}
      onClose={vi.fn()}
      onStopSession={input?.onStopSession ?? vi.fn()}
      onResumeSession={input?.onResumeSession ?? vi.fn()}
      onStartSession={input?.onStartSession ?? vi.fn()}
      onStartReview={input?.onStartReview ?? vi.fn()}
      onCreatePullRequest={input?.onCreatePullRequest ?? vi.fn()}
      onRefreshPullRequest={input?.onRefreshPullRequest ?? vi.fn()}
      onUpdateStatus={input?.onUpdateStatus ?? vi.fn()}
      onDeleteTask={input?.onDeleteTask ?? vi.fn()}
      onSetJiraLink={vi.fn()}
      onSessionExit={vi.fn()}
      onSessionInput={vi.fn()}
    />,
  );
}

describe("TaskWorkspace", () => {
  it("shows running controls and task metadata in the inspector rail", () => {
    const onStopSession = vi.fn();
    const runningTask: TaskSummary = {
      ...task,
      status: "planned",
      activeSessionId: "session-123",
      lastSessionAgent: "codex",
    };

    renderTaskWorkspace({ task: runningTask, onStopSession });

    screen.getByRole("button", { name: /^stop session$/i }).click();

    expect(onStopSession).toHaveBeenCalledWith("session-123");
    expect(screen.getByLabelText(/task inspector/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /agent workspace stage/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /task status/i })).toBeInTheDocument();
    expect(screen.getByText("Worktree", { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(screen.getByText("feat/card-ellipsis")).toBeInTheDocument();
    // The agent now identifies the session at the top of the facts rail.
    expect(screen.getByText("codex")).toBeInTheDocument();
  });

  it("shows launcher controls for saved sessions when no session is active", () => {
    const onResumeSession = vi.fn();
    const onStartSession = vi.fn();
    const resumableTask: TaskSummary = {
      ...task,
      activeSessionId: null,
      lastSessionId: "saved-session-123",
    };

    renderTaskWorkspace({ task: resumableTask, onResumeSession, onStartSession });

    expect(screen.getByRole("region", { name: /agent workspace stage/i })).toHaveTextContent("No active session");
    screen.getByRole("button", { name: /resume session/i }).click();
    screen.getByRole("button", { name: /restart agent/i }).click();

    expect(onResumeSession).toHaveBeenCalledWith(resumableTask);
    expect(onStartSession).toHaveBeenCalledWith(resumableTask);
  });

  it("updates status from the compact metadata strip", async () => {
    const onUpdateStatus = vi.fn();

    renderTaskWorkspace({ onUpdateStatus });

    fireEvent.click(screen.getByRole("combobox", { name: /task status/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Review" }));

    expect(onUpdateStatus).toHaveBeenCalledWith(task, "review");
  });

  it("truncates long finished attention content in the sidebar panel", () => {
    const message = "A".repeat(220);

    renderTaskWorkspace({
      attention: {
        taskId: task.id,
        kind: "idle",
        title: task.title,
        agentName: task.agentName,
        message,
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    const truncated = `${"A".repeat(180)}...`;
    const detail = screen.getByText(truncated);

    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(detail).toHaveAttribute("title", message);
  });

  it("shows single-review controls without rounds", () => {
    renderTaskWorkspace({ task: { ...task, status: "review" } });

    expect(screen.getByRole("button", { name: /review with claude review/i })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /reviewer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start pair loop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /max rounds/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
  });

  it("starts an immediate review from the workflow stepper", () => {
    const onStartReview = vi.fn();
    const reviewTask: TaskSummary = { ...task, status: "review" };

    renderTaskWorkspace({ task: reviewTask, onStartReview });

    screen.getByRole("button", { name: /review with claude review/i }).click();

    expect(onStartReview).toHaveBeenCalledWith(reviewTask, 2);
  });

  it("changes the reviewer from the review action dropdown", async () => {
    const onStartReview = vi.fn();
    const reviewTask: TaskSummary = { ...task, status: "review" };

    renderTaskWorkspace({ task: reviewTask, onStartReview });

    fireEvent.keyDown(screen.getByRole("button", { name: /change reviewer/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /gemini/i }));
    screen.getByRole("button", { name: /review with gemini/i }).click();

    expect(onStartReview).toHaveBeenCalledWith(reviewTask, 3);
  });

  it("runs task workflow actions from the sidebar stepper", () => {
    const onStartReview = vi.fn();
    const inReviewTask: TaskSummary = { ...task, status: "review" };

    renderTaskWorkspace({ task: inReviewTask, onStartReview });

    screen.getByRole("button", { name: /review with claude review/i }).click();
    expect(onStartReview).toHaveBeenCalledWith(inReviewTask, 2);

    expect(screen.getByRole("tab", { name: /create pr/i })).toBeDisabled();
  });

  it("opens the read-only reviewer terminal from the stage toggle", () => {
    renderTaskWorkspace({ task: { ...task, status: "review" } });

    fireEvent.click(screen.getByLabelText("Show reviewer terminal"));

    expect(screen.getByTestId("review-terminal")).toBeInTheDocument();
    expect(screen.getByText(/no review output yet/i)).toBeInTheDocument();
  });

  it("auto-switches to the reviewer terminal while a review is running", () => {
    renderTaskWorkspace({
      task: { ...task, status: "review" },
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "reviewing",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
      },
    });

    expect(screen.getByTestId("review-terminal")).toBeInTheDocument();
    expect(screen.getByText(/waiting for the reviewer/i)).toBeInTheDocument();
  });

  it("opens the reviewer terminal from the review card for a finished run", () => {
    renderTaskWorkspace({
      task: { ...task, status: "review" },
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "passed",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
      },
      reviewRuns: [
        {
          id: 1,
          taskId: task.id,
          reviewerProfileId: 2,
          verdict: "pass",
          prompt: "Review this",
          output: "Inspected the worktree. NECTUS_NO_BLOCKERS",
          error: null,
          createdAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /open reviewer terminal/i }));

    expect(screen.getByTestId("review-terminal")).toBeInTheDocument();
    expect(screen.queryByText(/no review output yet/i)).not.toBeInTheDocument();
  });

  it("moves the task to done from the current workflow step", () => {
    const onUpdateStatus = vi.fn();
    // A linked PR advances the ribbon so "Move to done" is the current step and
    // surfaces its inline action.
    const readyTask: TaskSummary = {
      ...task,
      status: "review",
      prUrl: "https://github.com/hvp17/nectus/pull/9",
    };

    renderTaskWorkspace({ task: readyTask, onUpdateStatus });

    screen.getByRole("button", { name: /move to done/i }).click();
    expect(onUpdateStatus).toHaveBeenCalledWith(readyTask, "done");
  });

  it("triggers PR creation from the workflow step when an agent session is active", () => {
    const onCreatePullRequest = vi.fn();
    const runningTask: TaskSummary = {
      ...task,
      status: "review",
      activeSessionId: "session-123",
    };

    renderTaskWorkspace({
      task: runningTask,
      onCreatePullRequest,
      // A passed review makes "Create PR" the current step, surfacing its action.
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "passed",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    expect(screen.getByText(/ask the running agent to open a pull request/i)).toBeInTheDocument();

    const createPrButton = screen.getByRole("button", { name: /create pull request/i });
    expect(createPrButton).not.toBeDisabled();
    createPrButton.click();

    expect(onCreatePullRequest).toHaveBeenCalledWith(runningTask);
  });

  it("creates a pull request from the GitHub panel when connected", () => {
    const onCreatePullRequest = vi.fn();
    const worktreeTask: TaskSummary = {
      ...task,
      status: "review",
      activeSessionId: null,
      prUrl: null,
    };

    renderTaskWorkspace({
      task: worktreeTask,
      githubStatus: { installed: true, authenticated: true, account: "hvp17" },
      onCreatePullRequest,
    });

    screen.getByRole("button", { name: /create pull request/i }).click();

    expect(onCreatePullRequest).toHaveBeenCalledWith(worktreeTask, { draft: false });
  });

  it("opens the linked pull request in the default browser from the pull request card", () => {
    const prUrl = "https://github.com/hvp17/nectus/pull/123";
    const linkedTask: TaskSummary = { ...task, prUrl };

    renderTaskWorkspace({ task: linkedTask });

    screen.getByRole("link", { name: /open pull request/i }).click();

    expect(mockedOpenExternal).toHaveBeenCalledWith(prUrl);
  });

  it("keeps the create pr step completed when a pull request is linked", () => {
    const onCreatePullRequest = vi.fn();
    const linkedTask: TaskSummary = {
      ...task,
      activeSessionId: "session-123",
      prUrl: "https://github.com/hvp17/nectus/pull/123",
    };

    renderTaskWorkspace({ task: linkedTask, onCreatePullRequest });

    expect(screen.getByRole("tab", { name: /create pr/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /ask agent to create pull request/i })).not.toBeInTheDocument();
    expect(screen.getByText(/pull request linked/i)).toBeInTheDocument();
  });

  it("shows review progress in the workflow stepper", () => {
    renderTaskWorkspace({
      task: { ...task, status: "review" },
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "reviewing",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    const reviewButton = screen.getByRole("button", { name: /reviewing with claude review/i });

    expect(reviewButton).toBeDisabled();
  });

  it("keeps blocker feedback on the review workflow step", () => {
    renderTaskWorkspace({
      task: { ...task, status: "review" },
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "feedback_sent",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    expect(screen.getByRole("tab", { name: /review/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /create pr/i })).toHaveAttribute("aria-selected", "false");
  });

  it("shows review loop status and latest review output", () => {
    renderTaskWorkspace({
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        status: "feedback_sent",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:02:00.000Z",
      },
      reviewRuns: [
        {
          id: 10,
          taskId: task.id,
          reviewerProfileId: 2,
          verdict: "feedback",
          prompt: "Review the worktree",
          output: "NECTUS_FEEDBACK\nConsider moving this into a smaller helper.",
          error: null,
          createdAt: "2026-05-15T00:01:00.000Z",
        },
      ],
    });

    expect(screen.getByText(/review feedback/i)).toBeInTheDocument();
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
    expect(screen.getByText(/consider moving this into a smaller helper/i)).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  it("uses the live terminal stage for an active session", () => {
    renderTaskWorkspace({ task: { ...task, activeSessionId: "session-123" } });

    const terminalPanel = screen.getByRole("region", { name: /agent workspace stage/i });

    expect(terminalPanel).not.toHaveTextContent("No active session");
    expect(screen.queryByRole("separator", { name: /resize terminal/i })).not.toBeInTheDocument();
  });

  it("switches the workspace stage to the diff view", async () => {
    renderTaskWorkspace();

    fireEvent.click(screen.getByText("Diff"));

    // The non-Tauri api fallback returns an empty diff, so the stage shows the
    // diff's empty state rather than the terminal.
    expect(await screen.findByText("No changes yet")).toBeInTheDocument();
  });
});
