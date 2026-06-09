import { describe, expect, it } from "vitest";
import { taskFinishedToast, taskNeedsInputToast, taskToastFromContent } from "./taskNotification";
import type { SessionIdleEvent, SessionNeedsInputEvent, TaskSummary } from "./types";

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary =>
  ({ id: 7, title: "Wire up auth", agentName: "Claude", agentKind: "claude", ...overrides }) as unknown as TaskSummary;

describe("taskFinishedToast", () => {
  it("links the toast to the task with a success kind", () => {
    const payload: SessionIdleEvent = { sessionId: "s1", taskId: 7, message: "all green" };

    expect(taskFinishedToast(task(), payload)).toEqual({
      taskId: 7,
      title: "Claude finished",
      body: "Wire up auth all green",
      kind: "success",
      agentKind: "claude",
    });
  });

  it("carries the agent kind for the provider logo, defaulting to custom", () => {
    const payload: SessionIdleEvent = { sessionId: "s1", taskId: 7 };

    expect(taskFinishedToast(task({ agentKind: "codex" }), payload).agentKind).toBe("codex");
    expect(taskFinishedToast(task({ agentKind: null }), payload).agentKind).toBe("custom");
  });

  it("omits the detail when the event has no message", () => {
    const payload: SessionIdleEvent = { sessionId: "s1", taskId: 7, message: null };

    expect(taskFinishedToast(task(), payload).body).toBe("Wire up auth");
  });

  it("falls back to Codex when the task has no agent name", () => {
    const payload: SessionIdleEvent = { sessionId: "s1", taskId: 7 };

    expect(taskFinishedToast(task({ agentName: null }), payload).title).toBe("Codex finished");
  });
});

describe("taskNeedsInputToast", () => {
  it("links the toast to the task with an info kind", () => {
    const payload: SessionNeedsInputEvent = {
      sessionId: "s1",
      taskId: 7,
      reason: "permission",
      prompt: "Approve?",
    };

    expect(taskNeedsInputToast(task(), payload)).toEqual({
      taskId: 7,
      title: "Claude needs input",
      body: "Wire up auth (permission): Approve?",
      kind: "info",
      agentKind: "claude",
    });
  });

  it("omits the prompt when the event has none", () => {
    const payload: SessionNeedsInputEvent = { sessionId: "s1", taskId: 7, reason: "permission" };

    expect(taskNeedsInputToast(task(), payload).body).toBe("Wire up auth (permission)");
  });
});

describe("taskToastFromContent", () => {
  it("formats an already-derived notification body and preserves the toast kind", () => {
    expect(
      taskToastFromContent(
        task({ agentKind: "codex" }),
        { title: "Codex needs input", body: "**Wire up auth** with `token`" },
        "info",
      ),
    ).toEqual({
      taskId: 7,
      title: "Codex needs input",
      body: "Wire up auth with token",
      kind: "info",
      agentKind: "codex",
    });
  });
});
