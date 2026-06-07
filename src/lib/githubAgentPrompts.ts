import type { MergeMethod } from "../types";

/**
 * Prompts the app submits into a task's running agent session to drive GitHub
 * pull-request actions. The agent runs `git`/`gh` itself in the task worktree, so
 * it can push, rebase, resolve conflicts, and report back. These strings are the
 * single iteration surface for shipping behavior — tune wording here, not in Rust.
 */

export function createPrPrompt({ draft }: { draft: boolean }): string {
  return [
    "Open a GitHub pull request for this task's branch using the `gh` CLI.",
    "- Commit any outstanding work with a Conventional Commit message and push the branch to its remote first.",
    "- Write the pull request title and description yourself from the actual changes on this branch — do not ask me for them.",
    `- Open it against the remote default branch${draft ? " as a draft" : ""}.`,
    "- If a pull request already exists for this branch, update it instead of failing.",
    "Report the pull request URL here when you're done.",
  ].join("\n");
}

export function mergePrPrompt(method: MergeMethod): string {
  return [
    `Merge this task's pull request using \`gh pr merge --${method}\`.`,
    "- If the branch is behind its base or has merge conflicts, rebase it onto the base branch, resolve the conflicts, push, then merge.",
    "- Do not delete the branch.",
    "Report the result here when you're done.",
  ].join("\n");
}

export function markReadyPrompt(): string {
  return [
    "Mark this task's pull request ready for review using `gh pr ready`.",
    "Report the result here when you're done.",
  ].join("\n");
}

export function closePrPrompt(): string {
  return [
    "Close this task's pull request without merging it, using `gh pr close`.",
    "Do not delete the branch.",
    "Report the result here when you're done.",
  ].join("\n");
}
