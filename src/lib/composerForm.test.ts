import { describe, expect, it } from "vitest";
import {
  createBranchIdentifier,
  getSuggestedWorktreeBranchName,
  resolveWorktreeBranchName,
} from "./composerForm";

describe("getSuggestedWorktreeBranchName", () => {
  it("joins a trimmed prefix with the identifier", () => {
    expect(getSuggestedWorktreeBranchName("feature/", "task-1")).toBe("feature/task-1");
    expect(getSuggestedWorktreeBranchName("  feature/  ", "task-1")).toBe("feature/task-1");
  });

  it("returns just the identifier when no prefix is set", () => {
    expect(getSuggestedWorktreeBranchName(null, "task-1")).toBe("task-1");
    expect(getSuggestedWorktreeBranchName(undefined, "task-1")).toBe("task-1");
    expect(getSuggestedWorktreeBranchName("", "task-1")).toBe("task-1");
  });
});

describe("resolveWorktreeBranchName", () => {
  it("uses a user-typed branch name when it is set and differs from the prefix", () => {
    expect(resolveWorktreeBranchName("my-branch", "feature/", "task-1")).toBe("my-branch");
  });

  it("trims a user-typed branch name", () => {
    expect(resolveWorktreeBranchName("  my-branch  ", "feature/", "task-1")).toBe("my-branch");
  });

  it("falls back to the suggested name when the branch name is empty", () => {
    expect(resolveWorktreeBranchName("", "feature/", "task-1")).toBe("feature/task-1");
    expect(resolveWorktreeBranchName("   ", "feature/", "task-1")).toBe("feature/task-1");
  });

  it("falls back to the suggested name when the branch name is only the prefix", () => {
    // The composer pre-fills the field with the prefix; leaving it untouched should
    // still generate a unique branch rather than reuse the bare prefix.
    expect(resolveWorktreeBranchName("feature/", "feature/", "task-1")).toBe("feature/task-1");
  });

  it("uses the typed name verbatim when there is no prefix", () => {
    expect(resolveWorktreeBranchName("my-branch", null, "task-1")).toBe("my-branch");
  });
});

describe("createBranchIdentifier", () => {
  it("prefixes the identifier with task-", () => {
    expect(createBranchIdentifier()).toMatch(/^task-/);
  });

  it("produces a different identifier each call", () => {
    expect(createBranchIdentifier()).not.toBe(createBranchIdentifier());
  });
});
