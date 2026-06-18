import { describe, expect, it } from "vitest";
import { applyChatRuntimeUpdate, type ChatRuntimeStore } from "./applyChatRuntime";
import type { TaskAttention } from "@/sessionAttention";
import type { ChatMessage, ChatMessageEvent, ChatPart, TaskSummary } from "@/types";

function createStore(initial: Partial<{ taskAttention: TaskAttention[] }> = {}) {
  const state = {
    liveLines: {} as Record<number, string>,
    chatWorkingTaskIds: {} as Record<number, true>,
    taskAttention: initial.taskAttention ?? ([] as TaskAttention[]),
  };
  const apply = <T,>(value: T | ((current: T) => T), current: T): T =>
    typeof value === "function" ? (value as (c: T) => T)(current) : value;
  const store: ChatRuntimeStore = {
    get liveLines() {
      return state.liveLines;
    },
    get chatWorkingTaskIds() {
      return state.chatWorkingTaskIds;
    },
    get taskAttention() {
      return state.taskAttention;
    },
    setLiveLines: (value) => {
      state.liveLines = apply(value, state.liveLines);
    },
    setChatWorkingTaskIds: (value) => {
      state.chatWorkingTaskIds = apply(value, state.chatWorkingTaskIds);
    },
    setTaskAttention: (value) => {
      state.taskAttention = apply(value, state.taskAttention);
    },
  };
  return { store, state };
}

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 1,
    repoId: 1,
    taskRepos: [],
    title: "A task",
    prompt: null,
    status: "in_progress",
    prUrl: null,
    agentProfileId: 1,
    agentName: "Claude",
    agentKind: "claude",
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
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

function agentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "agent-1",
    role: "agent",
    parts: [{ type: "text", text: "Done editing." }],
    createdAt: "2026-06-18T00:00:00.000Z",
    completedAt: "2026-06-18T00:01:00.000Z",
    ...overrides,
  };
}

function event(message: ChatMessage, done: boolean): ChatMessageEvent {
  return { sessionId: "chat-1", taskId: 1, agentProfileId: 1, message, done };
}

describe("applyChatRuntimeUpdate finished turn", () => {
  it("sets a finished (idle) attention carrying the closing line when a turn completes", () => {
    const { store, state } = createStore();
    const message = agentMessage({ parts: [{ type: "text", text: "Which do you prefer?" }] });

    const outcome = applyChatRuntimeUpdate(store, event(message, true), task(), [message]);

    expect(state.taskAttention).toHaveLength(1);
    expect(state.taskAttention[0]).toMatchObject({
      taskId: 1,
      kind: "idle",
      message: "Which do you prefer?",
    });
    expect(outcome.finished).toBe(true);
    expect(outcome.finishedLine).toBe("Which do you prefer?");
  });

  it("clears a stale finished attention once the agent starts working again", () => {
    const { store, state } = createStore({
      taskAttention: [{ taskId: 1, kind: "idle", title: "A task", message: "old", updatedAt: "x" }],
    });
    const streaming = agentMessage({ completedAt: null, parts: [{ type: "text", text: "Working…" }] });

    const outcome = applyChatRuntimeUpdate(store, event(streaming, false), task(), [streaming]);

    expect(state.taskAttention).toEqual([]);
    expect(state.chatWorkingTaskIds).toEqual({ 1: true });
    expect(outcome.finished).toBe(false);
  });

  it("does not treat a resolved permission message as a finished turn", () => {
    const { store, state } = createStore();
    const resolved = agentMessage({ id: "perm-xyz", parts: [{ type: "text", text: "Approved" }] });

    const outcome = applyChatRuntimeUpdate(store, event(resolved, true), task(), [resolved]);

    expect(state.taskAttention).toEqual([]);
    expect(outcome.finished).toBe(false);
  });

  it("still surfaces a pending permission request as needs_input", () => {
    const { store, state } = createStore();
    const permissionPart: ChatPart = {
      type: "permission",
      requestId: "r1",
      title: "Run npm test",
      options: [
        { optionId: "allow", label: "Allow", kind: "allow_once" },
        { optionId: "deny", label: "Deny", kind: "reject_once" },
      ],
    };
    const pending = agentMessage({ id: "perm-1", completedAt: null, parts: [permissionPart] });

    const outcome = applyChatRuntimeUpdate(store, event(pending, false), task(), [pending]);

    expect(state.taskAttention[0]).toMatchObject({ taskId: 1, kind: "needs_input", reason: "Run npm test" });
    expect(outcome.finished).toBe(false);
  });

  it("does not clear a pending needs_input when an unrelated chunk streams", () => {
    const { store, state } = createStore({
      taskAttention: [{ taskId: 1, kind: "needs_input", title: "A task", prompt: "Allow?", updatedAt: "x" }],
    });
    const streaming = agentMessage({ completedAt: null, parts: [{ type: "text", text: "Working…" }] });

    applyChatRuntimeUpdate(store, event(streaming, false), task(), [streaming]);

    expect(state.taskAttention[0]).toMatchObject({ kind: "needs_input" });
  });
});
