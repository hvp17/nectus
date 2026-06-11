import { describe, expect, it } from "vitest";
import {
  clearTaskAttention,
  formatAttentionReason,
  getAttentionCounts,
  getTaskAttention,
  upsertTaskAttention,
  type TaskAttention,
} from "./sessionAttention";
import type { SessionIdleEvent, SessionNeedsInputEvent, TaskSummary } from "./types";

const task: TaskSummary = {
  id: 21,
  repoId: 7,
  taskRepos: [],
  title: "Wire task attention",
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/attention",
  worktreePath: "/tmp/attention",
  isDirty: true,
  archived: false,
  activeSessionId: "session-21",
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

describe("sessionAttention", () => {
  it("tracks a task that needs input and replaces stale attention for the same task", () => {
    const current: TaskAttention[] = [
      {
        taskId: task.id,
        kind: "idle",
        title: task.title,
        agentName: "Codex",
        message: "Previous run finished",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ];
    const event: SessionNeedsInputEvent = {
      sessionId: "session-21",
      taskId: task.id,
      turnId: "turn-1",
      reason: "approval_request",
      prompt: "Allow command?",
    };

    const next = upsertTaskAttention(current, task, event, "2026-05-14T00:01:00.000Z");

    expect(next).toEqual([
      {
        taskId: task.id,
        kind: "needs_input",
        title: task.title,
        agentName: "Codex",
        reason: "approval_request",
        prompt: "Allow command?",
        updatedAt: "2026-05-14T00:01:00.000Z",
      },
    ]);
  });

  it("counts attention by state and clears a task once work resumes", () => {
    const idleEvent: SessionIdleEvent = {
      sessionId: "session-21",
      taskId: task.id,
      turnId: "turn-1",
      message: "Ready for review",
    };
    const next = upsertTaskAttention([], task, idleEvent, "2026-05-14T00:01:00.000Z");

    expect(getAttentionCounts(next)).toEqual({ needsInput: 0, finished: 1 });
    expect(clearTaskAttention(next, task.id)).toEqual([]);
  });

  it("finds attention for a task and returns undefined when absent", () => {
    const entry: TaskAttention = {
      taskId: task.id,
      kind: "needs_input",
      title: task.title,
      agentName: "Codex",
      updatedAt: "2026-05-14T00:01:00.000Z",
    };

    expect(getTaskAttention([entry], task.id)).toBe(entry);
    expect(getTaskAttention([entry], 999)).toBeUndefined();
    expect(getTaskAttention([], task.id)).toBeUndefined();
  });
});

describe("formatAttentionReason", () => {
  it("falls back to a generic label when no reason is given", () => {
    expect(formatAttentionReason()).toBe("Needs input");
    expect(formatAttentionReason(null)).toBe("Needs input");
    expect(formatAttentionReason("")).toBe("Needs input");
  });

  it("turns a snake_case reason code into Title Case words", () => {
    expect(formatAttentionReason("approval_request")).toBe("Approval Request");
    expect(formatAttentionReason("tool_use")).toBe("Tool Use");
  });

  it("capitalizes a single word", () => {
    expect(formatAttentionReason("blocked")).toBe("Blocked");
  });
});
