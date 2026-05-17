import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import type { AgentProfile, ReviewLoop, ReviewRun, TaskSummary } from "../types";
import { TaskWorkspace } from "./TaskWorkspace";

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
  onStopSession?: (sessionId: string) => void;
  onResumeSession?: (task: TaskSummary) => void;
  onStartSession?: (task: TaskSummary) => void;
  onStartReview?: (task: TaskSummary, reviewerProfileId: number) => void;
  onCreatePullRequest?: (task: TaskSummary) => void;
  onUpdateStatus?: (task: TaskSummary, status: TaskSummary["status"]) => void;
}) {
  return render(
    <TaskWorkspace
      task={input?.task ?? task}
      attention={input?.attention}
      agentProfiles={agentProfiles}
      reviewLoop={input?.reviewLoop ?? null}
      reviewRuns={input?.reviewRuns ?? []}
      onClose={vi.fn()}
      onStopSession={input?.onStopSession ?? vi.fn()}
      onResumeSession={input?.onResumeSession ?? vi.fn()}
      onStartSession={input?.onStartSession ?? vi.fn()}
      onStartReview={input?.onStartReview ?? vi.fn()}
      onCreatePullRequest={input?.onCreatePullRequest ?? vi.fn()}
      onUpdateStatus={input?.onUpdateStatus ?? vi.fn()}
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

    screen.getByRole("button", { name: /stop session/i }).click();

    expect(onStopSession).toHaveBeenCalledWith("session-123");
    expect(screen.getByLabelText(/task inspector/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /agent terminal/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /task status/i })).toBeInTheDocument();
    expect(screen.getByText("Worktree")).toBeInTheDocument();
    expect(screen.getByText("feat/card-ellipsis")).toBeInTheDocument();
    expect(screen.getByText(/PR:/i)).toBeInTheDocument();
    expect(screen.getByText(/Not linked/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent:/i)).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: /agent terminal/i })).toHaveTextContent("No active session");
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
    renderTaskWorkspace();

    expect(screen.getByRole("button", { name: /review with claude review/i })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /reviewer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start pair loop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /max rounds/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
  });

  it("starts an immediate review from the workflow stepper", () => {
    const onStartReview = vi.fn();

    renderTaskWorkspace({ onStartReview });

    screen.getByRole("button", { name: /review with claude review/i }).click();

    expect(onStartReview).toHaveBeenCalledWith(task, 2);
  });

  it("changes the reviewer from the review action dropdown", async () => {
    const onStartReview = vi.fn();

    renderTaskWorkspace({ onStartReview });

    fireEvent.keyDown(screen.getByRole("button", { name: /change reviewer/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /gemini/i }));
    screen.getByRole("button", { name: /review with gemini/i }).click();

    expect(onStartReview).toHaveBeenCalledWith(task, 3);
  });

  it("runs task workflow actions from the sidebar stepper", () => {
    const onStartReview = vi.fn();
    const onUpdateStatus = vi.fn();
    const inReviewTask: TaskSummary = { ...task, status: "review" };

    renderTaskWorkspace({ task: inReviewTask, onStartReview, onUpdateStatus });

    screen.getByRole("button", { name: /review with claude review/i }).click();
    expect(onStartReview).toHaveBeenCalledWith(inReviewTask, 2);

    expect(screen.getByRole("tab", { name: /create pr/i })).toBeDisabled();

    screen.getByRole("tab", { name: /move to done/i }).click();
    expect(onUpdateStatus).toHaveBeenCalledWith(inReviewTask, "done");
  });

  it("asks the active agent to create a pull request from the workflow", () => {
    const onCreatePullRequest = vi.fn();
    const runningTask: TaskSummary = {
      ...task,
      status: "review",
      activeSessionId: "session-123",
    };

    renderTaskWorkspace({ task: runningTask, onCreatePullRequest });

    const createPrStep = screen.getByRole("tab", { name: /create pr/i });
    expect(createPrStep).not.toBeDisabled();
    expect(screen.getByText(/ask the running agent to open a pull request/i)).toBeInTheDocument();

    screen.getByRole("button", { name: /ask agent to create pull request/i }).click();

    expect(onCreatePullRequest).toHaveBeenCalledWith(runningTask);
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

    const terminalPanel = screen.getByRole("region", { name: /agent terminal/i });

    expect(terminalPanel).not.toHaveTextContent("No active session");
    expect(screen.queryByRole("separator", { name: /resize terminal/i })).not.toBeInTheDocument();
  });
});
