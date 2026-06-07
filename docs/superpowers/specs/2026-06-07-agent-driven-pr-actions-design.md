# Agent-Driven PR Write Actions — Design

Date: 2026-06-07
Status: Approved for planning

## Motivation

Today every GitHub *write* action runs a deterministic `gh` call on a Rust worker
thread: `create_pull_request`, `merge_pull_request`, `set_pull_request_ready`,
`close_pull_request` (`native/src/github.rs`), wired to the UI through
`src/hooks/useGithub.ts` and `src/components/github/PullRequestActions.tsx`.

That path is fast and predictable but rigid: it cannot resolve a merge conflict,
rebase a behind branch, fix a failing check, or otherwise adapt. Every change to
how a PR is shipped means new Rust. The goal is to make these actions **easier to
iterate on** by routing them through the task's agent session — the agent already
has the full context of the work it did and can handle conflicts/rebases/retries.

## Core principle: reads stay deterministic, writes become prompts

The single decision that makes this safe:

- **Read** commands are unchanged. `github_pull_request_status`,
  `detect_github_pull_request`, the per-check drill-down, and the open-PR poll in
  `useGithub.ts` keep running as deterministic `gh` calls and keep driving the PR
  panel (status badge, draft state, check runs, review decision).
- **Write** commands stop calling `gh` and instead submit a prompt into the task's
  agent session. The agent runs `git`/`gh` itself.

Consequence: we do **not** lose the structured status display. It simply becomes
eventually-consistent — the panel refreshes after the agent finishes via the
`session_idle` event already wired in `useEventBridge` / `useTaskDiff`, plus a
manual refresh affordance.

## Scope

All four ship actions move to the agent-prompt path (decision: option B, uniform):

| Action      | Today                          | After                                   |
|-------------|--------------------------------|-----------------------------------------|
| Create PR   | push + `gh pr create` w/ title+body | prompt; **agent authors title + body** |
| Merge       | `gh pr merge --<method>`       | prompt; agent rebases/resolves if needed |
| Mark ready  | `gh pr ready`                  | prompt                                   |
| Close       | `gh pr close`                  | prompt                                   |

Explicitly **out of scope / unchanged**:

- `comment_on_pull_request` — this is the AI-review-posting path (`pr_review`),
  not a user ship button. Untouched.
- All read/detect/status commands.
- **No Rust changes.** The four `gh` write commands in `github.rs`
  (`create_pull_request`, `merge_pull_request`, `set_pull_request_ready`,
  `close_pull_request`) and their Tauri registrations are left **dormant** —
  no longer called by the ship UI, but still compiled, tested, and registered.
  Their `api.ts` wrappers stay too (still covered by `api.test.ts`). Deleting the
  dead path is a low-risk follow-up, intentionally deferred to keep this change
  frontend-only and reversible.

### Precedent already in the tree

`TaskWorkspaceOverlay.createPullRequest` already implements exactly this pattern
as a *fallback*: when a task has no worktree or `gh` isn't connected, it submits a
`CREATE_PULL_REQUEST_PROMPT` to `task.activeSessionId` via `api.submitSessionInput`.
This change generalizes that fallback into the **primary** path for all four
actions and centralizes the prompts. So the mechanism is proven, not new.

### Create PR: agent writes its own title and description

We pass **no** title or body. The prompt instructs the agent to write a clear PR
title and description itself from the branch's changes, and not to ask. This is
strictly better than today's `task.title` + original `task.prompt`, because the
agent has the actual diff in context.

## Components

### 1. Prompt templates — `src/lib/githubAgentPrompts.ts` (new)

Pure functions, one per action, returning the prompt string. This is the
"easy to iterate" surface — tuning behavior is a string edit, not Rust.

- `createPrPrompt({ draft }: { draft: boolean }): string`
  - "Create a GitHub pull request for the current branch using the `gh` CLI. Push
    the branch first if it isn't on the remote. Write a clear, descriptive title
    and description yourself based on the changes on this branch — do not ask me
    for them. Open it as a {draft|ready-for-review} PR."
- `mergePrPrompt(method: MergeMethod): string`
  - "Merge the pull request for the current branch using `gh pr merge --{method}`.
    If the branch is behind its base or has conflicts, rebase onto the base
    branch, resolve the conflicts, push, then merge. Do not delete the branch."
- `markReadyPrompt(): string` — "Mark the current branch's pull request ready for
  review with `gh pr ready`."
- `closePrPrompt(): string` — "Close the current branch's pull request without
  merging, using `gh pr close`. Do not delete the branch."

Unit-tested for the load-bearing phrases (authors-own-title, don't-delete-branch,
resolve-conflicts) so prompt edits that drop a guarantee fail a test.

### 2. Frontend ship-actions hook — `src/hooks/useGithubShipActions.ts` (new)

A focused hook returning the four action handlers with the **same signatures the
UI already expects** (`createPullRequest`, `mergePullRequest`,
`setPullRequestReady`, `closePullRequest`) plus the `creatingPullRequest` /
`pullRequestBusy` busy flags `GitHubPanel` consumes. Each handler:

1. If the task has no running session (`!task.activeSessionId`), surface a clear
   message ("Start or resume the agent to ship from here") and stop. A running
   session is the precondition — same contract the existing create-PR fallback
   already uses; auto-start is a deliberate non-goal for v1 (avoids the
   agent-boot readiness race entirely).
2. Clear the task's attention, then submit the action's prompt via the existing
   `api.submitSessionInput(task.activeSessionId, prompt)`.
3. Toast "Asked the agent to <action>…" so the user knows to watch the terminal.

This **reuses the existing `submit_session_input` command** — no new backend.
The four `useGithub` write functions and their busy state move out of `useGithub`
(which becomes read-only: status, PR read, refresh, detect) into this hook.

The buttons keep their **confirm dialogs** for Merge and Close (unchanged in
`PullRequestActions.tsx`) — these are irreversible, outward-facing actions, and
the confirmation is the safety the deterministic path otherwise provided. The
Merge dialog keeps its squash/merge/rebase picker; the method is interpolated
into the merge prompt. `GitHubPanel` / `PullRequestActions` are pure presentational
components and need **no changes** — only what their `on*` callbacks do changes.

### 3. Wiring — `TaskWorkspaceOverlay.tsx`

The overlay swaps the four `on*PullRequest` props (and the two busy flags) from
`useGithub` to the new `useGithubShipActions` hook, and drops its inline
dual-path `createPullRequest` (the deterministic `gh` branch and the bespoke
`CREATE_PULL_REQUEST_PROMPT`, now owned by the prompts module). It keeps using
`useGithub` for connection status and the live PR read.

### 4. Status refresh

No new mechanism. After the agent finishes a ship action it goes idle;
`session_idle` already triggers a PR-status refetch path. We additionally
invalidate `queryKeys.github.pullRequest(taskId)` on idle for the selected task,
and keep a manual "Refresh" affordance on the panel for the user to pull the
latest `gh pr view` on demand.

## Session precondition (how the readiness race is avoided)

Typing into a freshly *started* session can land before the agent's REPL is ready.
v1 sidesteps this entirely by requiring an **already-running** session: the action
submits into `task.activeSessionId` (a live, attached agent) or, if there is none,
declines with guidance to start/resume the agent first. No app-driven auto-start,
so there is no boot-timing window to get wrong. Auto-start (resume → wait for idle
→ submit) is a documented future enhancement, not v1.

## Risks & mitigations

- **Non-deterministic irreversible actions (merge/close).** Keep the confirm
  dialogs; scope each prompt tightly ("do not delete the branch"); the agent runs
  in the task's own worktree so blast radius is the task branch.
- **No running session (e.g. session exited).** The action declines with a clear
  message; the user starts/resumes the agent (one click) and retries. Consistent
  with the existing create-PR agent fallback.
- **Slower trivial actions (ready/close).** Accepted tradeoff for one uniform
  model (decision B).
- **Lost structured success result.** Replaced by eventual refresh from the
  unchanged read path; acceptable because reads stay authoritative.

## Testing

- Frontend: unit tests for the prompt builders' load-bearing phrases
  (authors-own-title, don't-delete-branch, resolve-conflicts, merge method
  interpolation); hook tests that each action submits the expected prompt via
  `submitSessionInput` when a session is running, and declines with guidance when
  none is. `GitHubPanel.test.tsx` / `api.test.ts` stay green unchanged.
- No Rust changes, so `cargo test` is a regression check only.
- `pnpm test`, `pnpm build`, `cd native && cargo test` before done.

## Documentation

- `docs/github-integration.md`: rewrite the create/merge/ready/close section to
  describe the agent-prompt model (reads deterministic, writes via the session),
  the readiness contract, and the no-session failure mode.
- `docs/features.md`: update the ship-actions ownership/behavior description.
- `CLAUDE.md`: update the `github.rs` bullet (write commands now flow through the
  session) and the command list if command registrations change.

## Non-goals

- No change to JIRA, the AI review loop, or PR-review posting.
- No app-managed GitHub auth/tokens (still `gh` CLI, now invoked by the agent).
- No background/headless shipping — actions run in the visible task session.
