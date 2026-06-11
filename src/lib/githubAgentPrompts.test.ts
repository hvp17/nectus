import { describe, expect, it } from "vitest";
import { closePrPrompt, createPrPrompt, markReadyPrompt, mergePrPrompt } from "./githubAgentPrompts";

describe("githubAgentPrompts", () => {
  it("create prompt tells the agent to author title and description itself", () => {
    const prompt = createPrPrompt({ draft: false });
    expect(prompt).toMatch(/title and description yourself/i);
    expect(prompt).toMatch(/\bgh\b/);
    expect(prompt).not.toMatch(/as a draft/i);
  });

  it("create prompt opens a draft when requested", () => {
    expect(createPrPrompt({ draft: true })).toMatch(/as a draft/i);
  });

  it("merge prompt interpolates the method, resolves conflicts, keeps the branch", () => {
    const prompt = mergePrPrompt("rebase");
    expect(prompt).toMatch(/gh pr merge --rebase/);
    expect(prompt).toMatch(/resolve the conflicts/i);
    expect(prompt).toMatch(/do not delete the branch/i);
  });

  it("mark-ready prompt uses gh pr ready", () => {
    expect(markReadyPrompt()).toMatch(/gh pr ready/);
  });

  it("close prompt closes without merging and keeps the branch", () => {
    const prompt = closePrPrompt();
    expect(prompt).toMatch(/gh pr close/);
    expect(prompt).toMatch(/without merging/i);
    expect(prompt).toMatch(/do not delete the branch/i);
  });
});

describe("repo-scoped prompts (cross-repo tasks)", () => {
  const repoScope = { repoName: "api-server", worktreePath: "/wt/branch/api-server" };

  it("prefixes every builder with the member repo's worktree when scoped", () => {
    for (const prompt of [
      createPrPrompt({ draft: false, repoScope }),
      mergePrPrompt("squash", repoScope),
      markReadyPrompt(repoScope),
      closePrPrompt(repoScope),
    ]) {
      expect(prompt.split("\n")[0]).toContain("api-server");
      expect(prompt.split("\n")[0]).toContain("/wt/branch/api-server");
    }
  });

  it("leaves prompts unscoped for the primary repo", () => {
    expect(createPrPrompt({ draft: false })).not.toContain("cd there first");
    expect(mergePrPrompt("squash")).not.toContain("cd there first");
  });
});
