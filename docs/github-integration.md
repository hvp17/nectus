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

## Create a pull request

- Available for worktree-backed tasks once GitHub is connected, from the task
  inspector's GitHub panel (and from the workflow stepper's `Create PR` step).
- Runs `git push --set-upstream origin HEAD` in the task worktree, then
  `gh pr create --title <task title> --body <task prompt> [--draft]`.
- The PR title defaults to the task title and the body to the task prompt; a
  `Draft` toggle opens the PR as a draft.
- The returned PR URL is captured and saved to the task automatically — no running
  agent session is required.
- For tasks without a worktree, the action falls back to the previous behavior:
  submitting a structured prompt into the active agent session asking it to open
  the PR from the terminal.

## Pull request status

- When a task has a linked PR and GitHub is connected, the panel shows live status
  from `gh pr view --json …`: state (Open / Draft / Merged / Closed), the CI check
  rollup summarized as passing / failing / pending counts, and the review decision
  (Approved / Changes requested / Review required).
- Checks awaiting a manual gate (`ACTION_REQUIRED`) or needing a re-run (`STALE`)
  are shown as pending rather than failing.
- `Open` links to the PR in the browser; `Refresh` re-fetches status. Status is
  best-effort: if the branch has no PR or `gh` errors, the stored PR link still
  shows.

## Requirements

- The GitHub CLI (`gh`) must be installed and authenticated (`gh auth login`).
- Creating a PR needs a worktree-backed task with at least one commit ahead of the
  repository's default branch and a GitHub remote (`origin`).

## Key files

- Task inspector panel: `src/components/GitHubPanel.tsx`
- Settings connection card: `src/components/SettingsPage.tsx`
- Connection and PR-status state: `src/hooks/useGithub.ts`
- Create-PR orchestration (gh path plus agent fallback): `src/hooks/useApp.ts`
- Frontend API: `src/api.ts`
- gh shell-out and output parsing: `native/src/github.rs`
- Backend commands: `github_status`, `create_github_pull_request`,
  `github_pull_request_status` (registered in `native/src/lib.rs`)
- PR URL persistence: `pr_url` column on the `tasks` table, via
  `update_task_metadata`
