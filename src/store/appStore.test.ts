import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./appStore";
import { resetAppStore } from "../test/testUtils";
import type { TaskAttention } from "../sessionAttention";

const s = () => useAppStore.getState();

describe("appStore", () => {
  beforeEach(() => resetAppStore());

  it("openWorkspaceBoard focuses the workspace and clears selection", () => {
    s().setSelectedRepoId(7);
    s().setSelectedTaskId(21);
    s().openWorkspaceBoard(9);
    expect(s().currentView).toBe("workspace");
    expect(s().activeWorkspaceId).toBe(9);
    expect(s().selectedRepoId).toBeUndefined();
    expect(s().selectedTaskId).toBeUndefined();
  });

  it("selection setters accept the useState updater form", () => {
    s().setSelectedTaskId(21);
    s().setSelectedTaskId((current) => (current === 21 ? undefined : current));
    expect(s().selectedTaskId).toBeUndefined();
  });

  it("setTaskAttention applies a functional update over current state", () => {
    const idleAttention = {
      taskId: 1,
      kind: "idle",
      title: "Finished task",
      message: "Done",
      updatedAt: "2026-06-09T00:00:00.000Z",
    } satisfies TaskAttention;
    const needsInputAttention = {
      taskId: 2,
      kind: "needs_input",
      title: "Blocked task",
      reason: "approval_request",
      prompt: "Approve command?",
      updatedAt: "2026-06-09T00:00:01.000Z",
    } satisfies TaskAttention;

    s().setTaskAttention(() => [
      idleAttention,
      needsInputAttention,
    ]);
    s().setTaskAttention((current) => current.filter((attention) => attention.taskId !== 1));
    expect(s().taskAttention).toHaveLength(1);
    expect(s().taskAttention[0]?.taskId).toBe(2);
  });

  it("setLiveLines merges per-task activity lines", () => {
    s().setLiveLines((current) => ({ ...current, 21: "working", 22: "idle" }));
    s().setLiveLines((current) => ({ ...current, 21: "done" }));
    expect(s().liveLines).toEqual({ 21: "done", 22: "idle" });
  });

  it("busy and message are plain setters", () => {
    s().setBusy(true);
    expect(s().busy).toBe(true);
    s().setMessage("Saved");
    expect(s().message).toBe("Saved");
  });
});
