import { describe, expect, it } from "vitest";
import { planTaskFocus } from "./taskNavigation";

describe("planTaskFocus", () => {
  it("dismisses the New Task composer so it cannot overlay the task workspace", () => {
    // Regression: opening a task (e.g. from an attention toast) while the
    // composer is open must close it, otherwise the composer branch wins the
    // viewport and the user never reaches the task details page.
    expect(planTaskFocus("board", { repoId: 3 }, true).dismissComposer).toBe(true);
  });

  it("leaves the composer untouched when it is not open", () => {
    expect(planTaskFocus("board", { repoId: 3 }, false).dismissComposer).toBe(false);
  });

  it("selects the task's repo when the task is known", () => {
    expect(planTaskFocus("mission", { repoId: 7 }, false).repoId).toBe(7);
  });

  it("leaves the repo unchanged when the task is not loaded", () => {
    expect(planTaskFocus("mission", undefined, false).repoId).toBeUndefined();
  });

  it("keeps mission and board views in place", () => {
    expect(planTaskFocus("mission", undefined, false).view).toBe("mission");
    expect(planTaskFocus("board", undefined, false).view).toBe("board");
  });

  it("routes secondary views to the board so the workspace can render", () => {
    expect(planTaskFocus("settings", undefined, false).view).toBe("board");
    expect(planTaskFocus("jira", undefined, false).view).toBe("board");
    expect(planTaskFocus("reviews", undefined, false).view).toBe("board");
  });
});
