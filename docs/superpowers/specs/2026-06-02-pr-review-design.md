# PR Review — Design

## Problem

Reviewing many incoming PRs from other people is manual. The user wants to paste a
GitHub PR link, have an agent review it against the real repository, and get a
human-readable review they can copy back to the author.

This is distinct from the existing **AI Review** feature, which reviews a *task's
own worktree* (work the user's own agent produced), parses the reviewer output into
`pass`/`needs_changes`/`feedback` markers, and injects feedback back into the worker
PTY. PR Review is the inverse: someone else's PR, output written for a human, no
marker parsing, no PTY injection.

## Decisions (from brainstorming)

- **Separate surface, shared engine.** PR Review is a new top-level section with its
  own entity and lifecycle, *not* a board Task. Underneath it reuses the existing
  worktree lifecycle (`git_ops.rs`), reviewer-launch logic (`sessions/review_loop.rs`),
  and `gh` plumbing (`github.rs`).
- **Repo resolution: known Projects only (Option A).** The PR's `owner/repo` is matched
  against the git remotes of repos already added to Nectus. If no Project matches, the
  create action fails with guidance to add the repo as a Project first. No filesystem
  scanning.
- **Output: display + copy only.** v1 shows the review text with a Copy button. No
  auto-posting to GitHub (`gh pr comment`) in v1.
- **Headless reviewer, document-first UI.** The reviewer runs headless (captured stdout,
  no live PTY), matching the existing review-loop. While running, the UI shows a
  spinner; when ready it shows the review document.

## Architecture

### Data model

New table `pr_reviews` (in `native/src/db/schema.rs`):

```sql
CREATE TABLE IF NOT EXISTS pr_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  reviewer_profile_id INTEGER NOT NULL REFERENCES agent_profiles(id),
  pr_url TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_title TEXT,
  pr_author TEXT,
  base_branch TEXT,
  status TEXT NOT NULL,          -- queued | reviewing | ready | error
  review_output TEXT,            -- markdown review, null until ready
  last_error TEXT,
  worktree_path TEXT,            -- ephemeral; null when not checked out
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pr_reviews_repo_idx ON pr_reviews(repo_id, id);
```

New enum `PrReviewStatus { Queued, Reviewing, Ready, Error }` in `models.rs`, mirroring
the `strum` derive pattern of `ReviewLoopStatus`. New serializable structs `PrReview`
and `PrReviewUpdatedEvent`. Frontend mirrors in `src/types.ts`: `PrReview`,
`PrReviewStatus`, `PrReviewUpdatedEvent`.

### Backend modules

- `native/src/github.rs`
  - `parse_pull_request_url(url) -> Result<ParsedPrUrl { owner, repo, number }, String>`
    — pure, tested. Accepts `https://github.com/owner/repo/pull/123`
    (tolerate trailing slash, `.git`, extra path like `/files`).
  - `fetch_pull_request_meta(repo_path, number) -> Result<PrMeta { title, author, base_branch }>`
    via `gh pr view <number> --json title,author,baseRefName` run in the repo dir.
- `native/src/git_ops.rs`
  - `remote_owner_repo(repo_path) -> Option<(String, String)>` — read `origin` (or first)
    remote URL and normalize both SSH (`git@github.com:owner/repo.git`) and HTTPS
    (`https://github.com/owner/repo(.git)`) forms to `(owner, repo)`. Pure parsing helper
    `parse_remote_owner_repo(url)` is unit-tested.
  - `fetch_pull_request_ref(repo_path, number, branch_name)` —
    `git fetch origin pull/<n>/head:<branch_name>` (works for fork PRs via the base
    repo's `refs/pull/*`).
  - `create_worktree_at_ref(repo_path, worktree_path, branch_name)` — add a worktree for
    an already-fetched local branch (no `--no-track`/base-branch logic; the branch exists).
    Existing `create_worktree` always branches from the remote default, so PR review needs
    this sibling that checks out the fetched PR branch.
- `native/src/db/pr_reviews.rs` — persistence: `create_pr_review`, `list_pr_reviews`,
  `pr_review_by_id`, `set_pr_review_status`, `set_pr_review_result`,
  `set_pr_review_worktree`, `delete_pr_review`. Row mapping in `db/rows.rs`.
- `native/src/db/mod.rs` — `resolve_repo_for_owner_repo(owner, repo) -> Option<Repo>`
  iterates `list_repos()` and matches via `git_ops::remote_owner_repo`.
- `native/src/sessions/pr_review.rs` — the background runtime, mirroring
  `review_loop.rs`:
  1. set `reviewing`, emit `pr_review_updated`
  2. `fetch_pull_request_meta` → backfill title/author/base, emit
  3. fetch PR ref + create ephemeral worktree (`pr-review-<n>` branch + path under the
     repo's `default_worktree_root`); persist `worktree_path`
  4. run reviewer headless with `build_pr_review_prompt(meta, number)` (asks for a
     structured markdown review for the author, base diff guidance, **no** NECTUS verdict
     tokens)
  5. store `review_output`, set `ready`, emit
  6. always tear down the worktree (`remove_worktree`) and clear `worktree_path`
  7. on any error: set `error` + `last_error`, tear down worktree, emit
  - Reuse the reviewer subprocess launch by extracting the current private
    `run_reviewer_command` in `review_loop.rs` to `pub(super)` so `pr_review.rs` calls it.

### Tauri commands (registered in `native/src/lib.rs`)

- `create_pr_review(pr_url, reviewer_profile_id?) -> PrReview` — parse URL, resolve repo
  (error if unknown), default reviewer to the app's default agent profile when omitted,
  insert `queued`, then spawn the background review thread. Async via `spawn_blocking`
  for the resolve+insert; kicks off the runtime thread like `run_pair_review`.
- `list_pr_reviews() -> Vec<PrReview>`
- `get_pr_review(id) -> Option<PrReview>`
- `rerun_pr_review(id) -> PrReview` — reset to `queued`, re-spawn the runtime (re-fetches
  the PR head, so it picks up new commits).
- `delete_pr_review(id)` — remove any lingering worktree, then delete the row.

New event: `pr_review_updated` carrying the updated `PrReview`.

### Frontend

- New `currentView` value `"reviews"`. Sidebar footer gains a **Reviews** nav item above
  **Settings** (icon + label), toggling `currentView`.
- `src/hooks/usePrReviews.ts` — owns review list state, create/rerun/delete, selection,
  subscription to `pr_review_updated` (refresh + toast/notification when a review becomes
  `ready` or `error`). Keeps this concern out of the already-large `useApp.ts`.
- `src/components/ReviewsPage.tsx` — master/detail:
  - **Create:** one URL input + reviewer `Select` + "Review PR" button (shadcn `Field`,
    `Input`, `Select`, `Button`).
  - **List:** review cards showing PR title/number, author, project, status badge.
  - **Detail (`PrReviewDetail.tsx`):** PR metadata header, status, and the review text in a
    `ScrollArea` (whitespace-preserved, readable GitHub-flavored markdown) with a prominent
    **Copy** button; `error` shows the `last_error` in an `Alert`; `reviewing`/`queued` show
    a `Skeleton`/spinner.
- `src/api.ts` — `createPrReview`, `listPrReviews`, `getPrReview`, `rerunPrReview`,
  `deletePrReview`, each guarded by the `isTauri` fallback like the existing wrappers.

## Error handling

- Unparseable URL → create fails: "Not a valid GitHub pull request URL".
- `owner/repo` not a known Project → create fails: "Add <owner>/<repo> as a project to
  review its pull requests".
- `gh` not installed/authenticated → metadata fetch fails; the run goes to `error` with a
  clear message (consistent with the rest of GitHub integration requiring `gh`).
- Reviewer non-zero exit → `error` with captured stderr.
- Worktree teardown always runs in the runtime's exit path so failed runs don't leak
  worktrees. Worktree removal is force-based and tolerant of an already-removed path,
  matching `git_ops::remove_worktree`.

## Testing

Rust:
- `parse_pull_request_url`: valid, trailing slash, `.git`, `/files` suffix, non-PR URL.
- `parse_remote_owner_repo`: SSH, HTTPS, `.git` suffix, non-GitHub remote.
- `build_pr_review_prompt`: includes PR number/title, asks for markdown, contains no
  `NECTUS_` tokens.
- DB (`db/tests.rs`): create→list→status/result transitions; `ON DELETE CASCADE` with repo;
  `resolve_repo_for_owner_repo` against a temp repo with a configured remote.
- `create_pr_review` rejects unknown repo and unparseable URL.

Frontend:
- `api.test.ts`: new wrappers invoke the right commands / browser fallback.
- `ReviewsPage` render + create interaction + Copy button writes review text to clipboard.
- `usePrReviews` updates list and notifies on `ready`/`error` events.

Run the standard gate before claiming done: `pnpm test`, `pnpm build`, `cd native && cargo test`.

## Out of scope (deferred)

- Structured findings → checkbox "assemble the comment" from selected findings.
- Rendered markdown (v1 shows readable raw markdown text).
- Auto-posting the review via `gh pr comment`.
- Side-by-side PR diff view.
- Automatic re-review on new commits (manual **Rerun** covers it).
- Watching the reviewer work live in an embedded terminal (v1 is headless with a spinner).
- Reviewing PRs for repos not added as Projects (filesystem scanning).

## Docs to update with implementation

- `docs/features.md`: new "PR Review" section + ownership map.
- `docs/github-integration.md`: PR-link review flow and `gh pr view` usage.
- `AGENTS.md`: new Tauri commands (`create_pr_review`, `list_pr_reviews`, `get_pr_review`,
  `rerun_pr_review`, `delete_pr_review`) and the `pr_review_updated` event.
