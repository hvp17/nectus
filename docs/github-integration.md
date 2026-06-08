# GitHub Integration

Nectus integrates with GitHub through the `gh` CLI. Because `gh` owns
authentication, Nectus stores no tokens and runs no OAuth flow — it shells out to
`gh` the same way it shells out to `git`.

## Connection

- On startup the app checks whether `gh` is installed and authenticated and which
  account is active (`gh --version`, `gh auth status`, `gh api user`).
- Settings shows a GitHub card: the connected account, or guidance to install `gh`
  or run `gh auth login`.
- Connection state gates the pull request UI — creation and live status only
  appear once `gh` is connected.

## Write actions are agent-driven

The four pull-request **write** actions — create, merge, mark-ready, close — do not
shell out to `gh` from Rust. Each submits a prompt into the task's **running agent
session** (`submit_session_input`), and the agent runs `git`/`gh` itself in the
worktree: it pushes, authors the PR body, rebases/resolves conflicts, and reports
back in the terminal. The **read** side (detection, live status, checks) stays
deterministic `gh`-shell-out and keeps driving the panel — see the sections below.

- The prompts live in `src/lib/githubAgentPrompts.ts` (the single place to tune
  shipping behavior); the dispatch hook is `src/hooks/useGithubShipActions.ts`.
- A write action requires a **running session** (`task.activeSessionId`). With none,
  it declines with guidance to start or resume the agent first — there is no
  app-driven auto-start (which would risk typing before the agent's REPL is ready).
- The status panel is eventually-consistent: after the agent finishes (and on the
  existing open-PR auto-refresh), the read path picks up the new/updated PR. A
  worktree task's freshly opened PR is backfilled by the existing detection step.

## Create a pull request

- Available for worktree-backed tasks once GitHub is connected, from the task
  inspector's GitHub panel (and from the workflow stepper's `Create PR` step).
- Submits a prompt asking the agent to commit/push the branch and open the PR with
  `gh`, **authoring the title and description itself** from the branch's changes
  (Nectus passes no title/body). A `Draft` toggle asks for a draft PR; if a PR
  already exists for the branch, the prompt asks the agent to update it.
- The opened PR's URL is backfilled to the task by the existing detection step
  (below), which then loads live status.

## Detecting an existing pull request

- When a worktree-backed task has no linked PR yet and GitHub is connected, Nectus
  asks `gh pr view` whether the branch already has a PR — so one opened outside
  Nectus (e.g. `gh pr create` or the GitHub web UI) is picked up automatically.
- Detection runs when such a task is selected. A found PR's URL is backfilled to the
  task (the same `pr_url` column the create flow writes), which then loads live
  status; a branch with no PR is left untouched and the `Create pull request` action
  stays available.
- `gh pr view` exits non-zero with `no pull requests found for branch …` when the
  branch has no PR; Nectus treats that as "not opened yet", not an error.

## Pull request status

- When a task has a linked PR and GitHub is connected, the panel shows live status
  from `gh pr view --json …`: state (Open / Draft / Merged / Closed), the CI check
  rollup summarized as passing / failing / pending counts, and the review decision
  (Approved / Changes requested / Review required).
- Checks awaiting a manual gate (`ACTION_REQUIRED`) or needing a re-run (`STALE`)
  are shown as pending rather than failing.
- **GitHub Actions / CI drill-down.** The same `statusCheckRollup` fetch also carries
  each check's name, workflow, conclusion, and details URL, so the checks row expands
  to a per-check list: each GitHub Actions run / commit status shows as
  `workflow / name` with a pass/fail/pending icon and a link to its run page (failing
  or running checks open straight to the logs). No extra `gh` call — the per-check
  list and the summary counts come from one `gh pr view`.
- **Auto-refresh.** While the panel shows a non-terminal PR (open / draft) and `gh`
  is connected, status re-fetches on a light interval and when the window regains
  focus, so long-running Actions move to green without a manual click. It stops once
  the PR is merged or closed.
- `Open` links to the PR in the browser; `Refresh` re-fetches status. Status is
  best-effort: if the branch has no PR or `gh` errors, the stored PR link still
  shows.

## Ship a pull request

Once a task's PR is open, `gh` is connected, and the agent session is running, the
GitHub panel can finish the PR by asking the agent (each action submits a prompt; the
agent runs the `gh`/`git` work in the worktree):

- **Merge** — a confirm dialog picks the strategy (squash default; `--squash` /
  `--merge` / `--rebase` is interpolated into the prompt) and surfaces the current
  review/checks state as context. The prompt asks the agent to **rebase onto the base
  and resolve conflicts** if the branch is behind or conflicting, then merge — work
  the old deterministic call could not do. It asks the agent **not** to delete the
  branch (it is checked out in the worktree; task deletion removes the worktree
  later). GitHub branch protection remains the real gate.
- **Mark ready** — asks the agent to promote a draft with `gh pr ready`.
- **Close** — asks the agent to `gh pr close` without merging, behind its own confirm.

The card flips to Merged / Ready / Closed once the read path refreshes (agent finish
+ the open-PR auto-refresh), not synchronously from the action's return value.

## Review an external pull request

The PR Reviews section reviews a pull request opened by someone else (see
[PR Review](features.md#pr-review) for the full feature behavior).

- A pasted PR URL (`https://github.com/owner/repo/pull/<n>`) is parsed into
  `owner`, `repo`, and number by `github::parse_pull_request_url`, then matched to a
  known project by comparing each project's `origin` remote
  (`git_ops::remote_owner_repo`) — so the repository must already be added to Nectus.
- PR metadata (title, author, base branch) is read with
  `gh pr view <n> --json title,author,baseRefName`, run inside the resolved local
  repository.
- The PR head is checked out into an ephemeral worktree with
  `git fetch --force origin pull/<n>/head:<branch>` followed by `git worktree add`;
  this works for fork PRs because GitHub exposes `refs/pull/<n>/head` on the base
  repository's remote. The branch/worktree are named
  `nectus-pr-review-<n>-<review_id>` (unique per review) so concurrent reviews of
  the same PR — a single plus a consensus review, or two reviews of one PR — never
  collide on the path or share a branch. The worktree **and** the ephemeral branch
  are always removed after the review, so reviewed PRs leave no branch trail. This
  lifecycle (naming, pre-clean, fetch+create, teardown) is owned by the shared
  `native/src/sessions/pr_worktree.rs` scaffold used by both review runtimes.

### Single vs consensus reviews

The reviewer toggles on the PR Reviews form choose how many models review:

- **One reviewer → single review.** The original flow: one reviewer CLI runs once
  in the ephemeral worktree (`native/src/sessions/pr_review.rs`) and returns the
  Markdown review plus a `NECTUS_VERDICT: BLOCKERS|CLEAN` marker (the shared
  verdict contract in `native/src/sessions/verdict.rs`).
- **Two or more reviewers → consensus review.** All selected reviewers review the
  same PR head in **one shared read-only worktree**, in parallel
  (`native/src/sessions/pr_consensus.rs`). After each round every reviewer is shown
  the others' reviews and asked to reconsider; rounds repeat until every reviewer
  reports the same non-inconclusive verdict, or the round cap is hit (default 3,
  max 5, chosen on the form). A final **synthesis pass** — run by the first selected
  reviewer — merges the last round's reviews into one consensus review the human can
  paste, preserving every distinct blocking issue and flagging any unresolved
  disagreement. When the reviewers converged, that shared verdict is authoritative;
  otherwise the synthesizer's verdict is used. Each reviewer's per-round output is
  stored so the detail view can show the rounds; the consensus run emits
  `pr_review_updated` as each round output lands.

### Post the review back to the PR

A finished review (single or consensus) can be posted to the actual pull request
with the **Post to PR** button on the review detail. It runs
`gh pr comment <n> --body <review>` in the resolved local repository, with a short
automated-attribution header prepended so it is not mistaken for a human review. It
is deliberately a **comment**, not `gh pr review --approve/--request-changes` — Nectus
never authors a formal approval on the user's behalf. Posting is re-runnable (e.g.
after a re-review) and is not persisted as "posted"; success surfaces a message.

## Requirements

- The GitHub CLI (`gh`) must be installed and authenticated (`gh auth login`).
- Creating a PR needs a worktree-backed task with at least one commit ahead of the
  repository's default branch and a GitHub remote (`origin`).
- Reviewing an external PR needs the repository added to Nectus as a project and a
  GitHub remote that resolves to the PR's `owner/repo`.

## Key files

- Task inspector panel: `src/components/GitHubPanel.tsx`, composing the ship actions
  (`src/components/github/PullRequestActions.tsx`) and the CI check drill-down
  (`src/components/github/PullRequestChecks.tsx`) — presentational, unchanged
- Settings connection card: `src/components/SettingsPage.tsx`
- Connection + PR-status read + auto-refresh + detection (read-only): `src/hooks/useGithub.ts`
- Agent-driven write actions (create/merge/ready/close): `src/hooks/useGithubShipActions.ts`,
  with the prompts in `src/lib/githubAgentPrompts.ts`; wired in `src/components/TaskWorkspaceOverlay.tsx`
- Post-review-to-PR action: `src/components/PrReviewDetail.tsx` + `src/hooks/usePrReviews.ts`
- Frontend API: `src/api.ts` (`submit_session_input` carries the write prompts)
- gh shell-out and output parsing — connection status, PR status/detection parsing
  (incl. the per-check CI drill-down), and `comment_on_pull_request`: `native/src/github.rs`.
  PR **writes** (create/merge/mark-ready/close) are agent-driven, not `gh`-shell-out
  from Rust — see *Write actions are agent-driven* above
- Backend commands: `github_status`, `github_pull_request_status`,
  `detect_github_pull_request`, `post_pr_review_comment` (registered in
  `native/src/lib.rs`)
- PR URL persistence: `pr_url` column on the `tasks` table, via
  `update_task_metadata`
