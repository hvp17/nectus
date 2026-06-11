import { describe, expect, it } from "vitest";
import { buildAgentRows, deriveAgentState } from "./agentState";
import type { TaskSummary } from "../types";

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 1,
    repoId: 1,
    taskRepos: [],
    title: "A task",
    prompt: null,
    status: "in_progress",
    prUrl: null,
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: "feat/x",
    worktreePath: "/tmp/wt/x",
    archived: false,
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    ...overrides,
  };
}

const repoNames = new Map([[1, "web-app"]]);

describe("deriveAgentState review-loop statuses", () => {
  // Every review-loop status must map to the "review" state so the Mission
  // Control rail colour agrees with the TaskCard review badge — an errored or
  // stopped review must not silently fall through to "idle".
  const reviewStatuses = ["running", "reviewing", "passed", "feedback_sent", "error", "stopped"] as const;

  for (const status of reviewStatuses) {
    it(`treats a "${status}" review loop as review`, () => {
      const t = task({ status: "in_progress", activeSessionId: null, reviewLoopStatus: status });
      expect(deriveAgentState(t)).toBe("review");
    });
  }
});

describe("deriveAgentState persisted attention", () => {
  it("treats a persisted needs_input attention as needs_you (survives reload)", () => {
    // No live push attention and no active session — only the backend-persisted
    // column. This is the reload case: the signal must still surface.
    const t = task({ activeSessionId: null, attention: "needs_input" });
    expect(deriveAgentState(t)).toBe("needs_you");
  });
});

describe("buildAgentRows live line", () => {
  it("uses the live activity line for a running task", () => {
    const running = task({ id: 1, activeSessionId: "s-1" });
    const [row] = buildAgentRows([running], [], repoNames, { 1: "Editing TaskCard.tsx" });

    expect(row.state).toBe("running");
    expect(row.line).toBe("Editing TaskCard.tsx");
  });

  it("falls back to the running label when there is no live line", () => {
    const running = task({ id: 1, activeSessionId: "s-1" });
    const [row] = buildAgentRows([running], [], repoNames, {});

    expect(row.line).toBe("Session running");
  });

  it("ignores a live line for a task that is not running", () => {
    const inReview = task({ id: 1, status: "review", activeSessionId: null });
    const [row] = buildAgentRows([inReview], [], repoNames, { 1: "stale line" });

    expect(row.state).toBe("review");
    expect(row.line).not.toBe("stale line");
  });
});
