# Codex Rolling Updates

> Working log for the Codex improvement loop. A parallel agent keeps
> `CLAUDE_ROLLING_UPDATES.md`. Before each commit, re-read that file, fetch/pull
> `main`, inspect the latest commit, and stage only Codex-owned files.

## Conventions

- Keep one contained, verified improvement per iteration.
- Avoid files or areas currently claimed in `CLAUDE_ROLLING_UPDATES.md`.
- Prefer simplification, dead-code removal, architecture cleanup, and concrete
  docs drift fixes over broad rewrites.
- Use current docs for the library or CLI that owns the chosen improvement.

## Coordination ledger

- Claude iteration 1 owned unused `@tanstack/react-router` removal:
  `package.json`, `pnpm-lock.yaml`, and `AGENTS.md`; it landed as `4b3fc06`.
- Claude's current uncommitted loop is simplifying
  `src/components/settings/UpdateCard.tsx` and `CLAUDE_ROLLING_UPDATES.md`.
  Codex will not edit those files in iteration 2.
- Untracked `.claude/` and `design-mockups/` existed before Codex edits and are
  not Codex-owned.

---

## Iteration log

### Iteration 1 - done (2026-06-09)

**Goal:** Move GitHub PR auto-detection out of the custom `useAsyncEffect` helper
and into the TanStack Query GitHub read layer.

**Rationale:** `useGithub` already reads GitHub status and PR status through
TanStack Query, but branch PR detection is still a one-off async effect. Making
it a query keeps GitHub command reads under `src/queries/`, matches the app's
documented server-state boundary, and should leave `useAsyncEffect` unused.

**Docs checked:** TanStack Query v5 docs for `enabled` dependent queries and the
v5 removal of `useQuery` callbacks. The documented pattern is to gate queries
with `enabled` and react to query data changes with a React effect.

**Claimed files:**
- `src/queries/github.ts`
- `src/queries/github.test.tsx`
- `src/queries/keys.ts`
- `src/hooks/useGithub.ts`
- `src/hooks/useAsyncEffect.ts`

**Verification plan:**
- Red: targeted Vitest for the new GitHub detection query.
- Green: targeted Vitest for the new query test.
- Full: `pnpm test`, `pnpm build`.
- Rust: skip unless Rust files change.

**Status:** verified; committing on top of Claude's dependency cleanup commit
`4b3fc06`.

**Evidence so far:**
- Red: `pnpm vitest run src/queries/github.test.tsx` failed because
  `useGithubPullRequestDetectionQuery` did not exist.
- Green: `pnpm vitest run src/queries/github.test.tsx` passed after adding the
  query hook and wiring `useGithub` to it.
- Full frontend tests: `pnpm test` passed (46 files, 290 tests).
- Frontend build: `pnpm build` passed.
- Rust tests: `cd native && cargo test` passed (240 tests).

**Commit:** `1cb6070` (`refactor(github): query branch pr detection`) pushed to
`origin/main`.

### Iteration 2 - done (2026-06-09)

**Goal:** Remove stale router-era test/docs references after the router
dependency cleanup.

**Rationale:** The app no longer uses TanStack Router, but `src/test/setup.ts`
still stubs `window.scrollTo` for router scroll restoration and `docs/features.md`
still says views render through the router's `<Outlet/>`. Removing the unused test
shim and fixing the feature doc keeps the repo aligned with the current
store-driven shell.

**Docs checked:** jsdom docs note that layout/rendering are not implemented and
that unsupported browser APIs can be shimmed in the environment when tests need
them. Since the current suite has no `window.scrollTo` callers, the stale shim
should be removed instead of carried forward.

**Claimed files:**
- `src/test/setup.ts`
- `docs/features.md`

**Verification plan:**
- `pnpm test`
- `pnpm build`

**Status:** verified and committed.

**Evidence:**
- `pnpm test` passed (46 files, 290 tests).
- `pnpm build` passed.

**Commit:** Changes landed in Claude's coalesced commit `bdccc36`
(`refactor(settings): flatten UpdateCard detail into a readable helper`) with
Claude's `UpdateCard` simplification.

### Iteration 3 - done (2026-06-09)

**Goal:** Remove sentinel `-1` GitHub query keys and unsafe task-id casts from the
GitHub query layer.

**Rationale:** `useGithubPullRequestQuery` and
`useGithubPullRequestDetectionQuery` currently allocate disabled cache entries
under fake `-1` task ids, then cast possibly missing task ids in their query
functions. TanStack Query v5 documents `skipToken` as the type-safe way to
disable queries when TypeScript input is absent. Using real optional ids in the
key and `skipToken` for missing inputs keeps the cache honest and removes casts.

**Docs checked:** TanStack Query v5 disabling guide for `skipToken`; it is
recommended for type-safe disabled queries when `refetch()` is not required.

**Claimed files:**
- `src/queries/github.ts`
- `src/queries/github.test.tsx`
- `src/queries/keys.ts`

**Verification plan:**
- Red: targeted Vitest for no `-1` sentinel cache entry.
- Green: targeted Vitest for GitHub query tests.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- Red: `pnpm vitest run src/queries/github.test.tsx` failed because a disabled
  no-task query allocated `["github", "pull-request", -1]`.
- Green: `pnpm vitest run src/queries/github.test.tsx` passed (3 tests).
- `pnpm build` passed.
- `pnpm test` passed (46 files, 291 tests).

**Commit:** Changes landed in Claude's coalesced commit `ba2c20f`
(`refactor(task-workspace): extract currentWorkflowStep helper`) with Claude's
TaskWorkspace helper extraction.

### Iteration 4 - done (2026-06-09)

**Goal:** Remove the placeholder `"none"` task-diff query key and unsafe task-id
cast from `useTaskDiff`.

**Rationale:** `useTaskDiff` is Query-backed but still allocates an idle cache
entry under `["task", "diff-summary", "none"]` when no task is selected, then
casts `taskId` in the query function. This mirrors the GitHub pattern removed in
iteration 3. `skipToken` can disable the query without fake ids or casts.

**Docs checked:** TanStack Query v5 disabling guide for `skipToken`.

**Claimed files:**
- `src/hooks/useTaskDiff.ts`
- `src/hooks/useTaskDiff.test.tsx`
- `src/queries/keys.ts`

**Verification plan:**
- Red: targeted Vitest for no `"none"` placeholder diff-summary cache entry.
- Green: targeted Vitest for `useTaskDiff`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified; committing.

**Evidence:**
- Red: `pnpm vitest run src/hooks/useTaskDiff.test.tsx` failed because a no-task
  diff hook allocated `["task", "diff-summary", "none"]`.
- Green: `pnpm vitest run src/hooks/useTaskDiff.test.tsx` passed (7 tests).
- `pnpm build` passed.
- `pnpm test` passed (46 files, 292 tests).

**Commit:** `720e4a8` (`refactor(diff): skip idle summary query sentinel`)
pushed to `origin/main`.

### Iteration 5 - done (2026-06-09)

**Goal:** Remove the placeholder PR-review runs query key and unsafe selected
review id cast from `usePrReviews`.

**Rationale:** `usePrReviews` still creates a disabled cache entry under
`["pr-reviews", "none", "runs"]` when no review is selected, then casts
`selectedPrReviewId` inside the runs query function. This is the same fake-id
pattern removed from GitHub and task diff queries.

**Docs checked:** TanStack Query v5 disabling guide for `skipToken`.

**Claimed files:**
- `src/hooks/usePrReviews.ts`
- `src/hooks/usePrReviews.test.ts`
- `src/queries/keys.ts`

**Verification plan:**
- Red: targeted Vitest for no `"none"` PR-review runs cache entry.
- Green: targeted Vitest for `usePrReviews`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified; committing.

**Evidence:**
- Red: `pnpm vitest run src/hooks/usePrReviews.test.ts` failed because a no-review
  hook allocated `["pr-reviews", "none", "runs"]`.
- Green: `pnpm vitest run src/hooks/usePrReviews.test.ts` passed (3 tests).
- `pnpm build` passed.
- `pnpm test` passed (46 files, 295 tests; Claude's active `profileDrafts` test
  changes were present but unstaged).

**Commit:** `c53b5ad`
(`refactor(pr-reviews): skip idle runs query sentinel`) pushed to `origin/main`.
The same push also carried Claude's already-committed `ed756b8`.

### Iteration 6 - done (2026-06-09)

**Goal:** Replace review-loop `-1` query sentinels with optional-id keys and
`skipToken`.

**Rationale:** `useTaskReviewLoop` intentionally keeps a disabled cache cell when
no task is selected so imperative setters still have somewhere to write. That
does not require a fake numeric task id; an optional-id key preserves the cache
cell while removing `?? -1` and `as number` casts.

**Docs checked:** TanStack Query v5 disabling guide for `skipToken`.

**Claimed files:**
- `src/hooks/useTaskReviewLoop.ts`
- `src/hooks/useTaskReviewLoop.test.tsx`
- `src/queries/keys.ts`

**Verification plan:**
- Red: targeted Vitest for no `-1` review-loop cache entries.
- Green: targeted Vitest for `useTaskReviewLoop`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified; committing.

**Evidence:**
- Red: `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` failed because a
  no-task hook allocated `["task", "review-loop", -1]`.
- Green: `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` passed (3 tests).
- `pnpm build` passed.
- `pnpm test` passed (46 files, 296 tests).

**Commit:** `c13f4e2`
(`refactor(review): skip idle task review sentinels`) pushed to `origin/main`.

### Iteration 7 - done (2026-06-09)

**Goal:** Remove the empty-string JIRA project-status query sentinel and unsafe
project cast.

**Rationale:** `useJiraProjectStatusesQuery` currently creates an idle cache entry
under `["jira", "project-statuses", ""]` when no project is configured, then
casts `project` in the query function. Optional project keys plus `skipToken`
match the cleaned-up Query pattern used elsewhere.

**Docs checked:** TanStack Query v5 disabling guide for `skipToken`.

**Claimed files:**
- `src/queries/jira.ts`
- `src/queries/jira.test.tsx`
- `src/queries/keys.ts`

**Verification plan:**
- Red: targeted Vitest for no empty-string JIRA project-status cache entry.
- Green: targeted Vitest for JIRA query tests.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified; committing.

**Evidence:**
- Red: `pnpm vitest run src/queries/jira.test.tsx` failed because a no-project
  query allocated `["jira", "project-statuses", ""]`.
- Green: `pnpm vitest run src/queries/jira.test.tsx` passed (1 test).
- `pnpm build` passed.
- `pnpm test` passed (47 files, 297 tests).

**Commit:** `7a55820`
(`refactor(jira): skip idle project status sentinel`) pushed to `origin/main`.

### Iteration 8 - in progress (2026-06-09)

**Goal:** Keep the JIRA board fresh after work-item comments and centralize the
board-refresh path for JIRA writes.

**Rationale:** `assign` and `create` already invalidate the board query after a
successful JIRA write, while `comment` only shows a message. Comments can update
server-side issue activity and should leave the board cache in the same refreshed
state as the other JIRA write actions.

**Docs checked:** TanStack Query v5 docs for query invalidation/disabling and
typed query hooks. The existing hook already uses query invalidation for active
board refreshes, so this iteration keeps that architecture instead of adding a
new local state path.

**Claimed files:**
- `src/hooks/useJira.ts`
- `src/hooks/useJira.test.ts`
- `docs/jira-integration.md`
- `docs/features.md`

**Verification plan:**
- Red: targeted Vitest proving comments do not currently refresh the board.
- Green: targeted Vitest for `useJira`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- Red: `pnpm vitest run src/hooks/useJira.test.ts` failed because
  `jiraSearchBoard` was called once after adding a comment.
- Green: `pnpm vitest run src/hooks/useJira.test.ts` passed (4 tests).
- `pnpm test` passed (48 files, 307 tests; includes the parallel agent's
  untracked `src/lib/composerForm.test.ts` in the shared worktree).
- `pnpm build` passed.

**Commit:** `f516e24` (`fix(jira): refresh board after comments`) pushed to
`origin/main`.

### Iteration 9 - done (2026-06-09)

**Goal:** Remove the New Task composer's workspace-seeding effect suppression and
cover late workspace hydration.

**Rationale:** `CreateTaskComposer` seeded a focused workspace's repo checklist
from an effect with an empty dependency list plus an `exhaustive-deps`
suppression. If the composer opened with a workspace id before workspace data
hydrated, the effect ran once with no selected workspace and never seeded the
checklist. React's docs recommend ref guards over suppressing dependency lint for
one-time effects.

**Docs checked:** React docs for effect dependencies and exhaustive-deps. The
documented pattern is to include the real dependencies and use a ref guard when
logic must run once.

**Claimed files:**
- `src/components/CreateTaskComposer.tsx`
- `src/components/CreateTaskComposer.test.tsx`
- `docs/features.md`

**Verification plan:**
- Red: targeted Vitest proving late workspace hydration does not seed the repo
  checklist.
- Green: targeted Vitest for `CreateTaskComposer`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- Red: `pnpm vitest run src/components/CreateTaskComposer.test.tsx` failed because
  `onSetRepoIds` was never called after workspace data arrived.
- Green: `pnpm vitest run src/components/CreateTaskComposer.test.tsx` passed (1
  test).
- `pnpm test` passed (49 files, 312 tests).
- `pnpm build` passed.

**Commit:** `075a393`
(`fix(composer): seed focused workspace after hydration`) pushed to `origin/main`.

### Iteration 10 - done (2026-06-09)

**Goal:** Remove the `TaskDiffView` exhaustive-deps suppression by making the
derived file list stable.

**Rationale:** `TaskDiffView` intentionally re-anchors the selected diff file only
when the summary changes, but it expressed that by depending on `summary` while
using `fileList` and suppressing `react-hooks/exhaustive-deps`. Memoizing
`summary?.files` by `summary` preserves the same re-anchor semantics and lets the
effect list its actual dependency.

**Docs checked:** React docs for effect dependencies and `useMemo` dependencies.
They recommend declaring every reactive value, and memoizing derived objects or
arrays when that is the intended dependency boundary.

**Claimed files:**
- `src/components/TaskDiffView.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskDiffView.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskDiffView.test.tsx` passed (6 tests).
- `pnpm test` passed (49 files, 312 tests).
- `pnpm build` passed.

**Commit:** `94bb5b4`
(`refactor(diff): remove file-list effect suppression`) pushed to `origin/main`.

### Iteration 11 - done (2026-06-09)

**Goal:** Remove the `useJira` columns memoization and its exhaustive-deps
suppression.

**Rationale:** The JIRA board columns are derived from at most the current board
items and project statuses. The prior `useMemo` depended on a manual joined
`statusFilterKey` because callers pass a fresh array, then suppressed
`exhaustive-deps`. Computing the pure `deriveColumns` result directly is easier
to reason about and removes the suppression without changing behavior.

**Docs checked:** React docs for `useMemo` and memoization guidance. Manual
memoization is useful for controlled performance boundaries, but it should not
make dependency tracking less explicit for cheap calculations.

**Claimed files:**
- `src/hooks/useJira.ts`

**Verification plan:**
- Focused: `pnpm vitest run src/hooks/useJira.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useJira.test.ts` passed (4 tests).
- `pnpm test` passed (49 files, 312 tests; Claude's in-progress
  `PullRequestChecks`/`collapsible` changes were present in the shared worktree).
- `pnpm build` passed.

**Commit:** `6181589` (`refactor(jira): simplify column derivation`) pushed to
`origin/main`.

### Iteration 12 - done (2026-06-09)

**Goal:** Remove the final `react-hooks/exhaustive-deps` suppression from
`TaskWorkspace`.

**Rationale:** The Diff tab should refresh when the user opens it, while task
switch refreshes stay owned by `useTaskDiff`. React 19.2's `useEffectEvent`
expresses that boundary directly: the effect is reactive to `stageTab`, and the
event reads the latest `refreshDiff` without making task switches trigger a second
refresh.

**Docs checked:** React docs for `useEffectEvent` and separating event logic from
effect dependencies. The examples keep the Effect Event out of the dependency list
and depend only on the value that should trigger synchronization.

**Claimed files:**
- `src/components/TaskWorkspace.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- First attempt with the Effect Event in the dependency list failed
  `pnpm vitest run src/components/TaskWorkspace.test.tsx` with a maximum update
  depth error, matching the docs warning that Effect Events are not reactive
  dependencies.
- Green: `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26
  tests).
- `rg -n "eslint-disable-next-line react-hooks/exhaustive-deps|eslint-disable-line react-hooks/exhaustive-deps" src/components src/hooks`
  returned no matches.
- `pnpm test` passed (49 files, 312 tests).
- `pnpm build` passed.

**Commit:** `16973e1`
(`refactor(task-workspace): use effect event for diff refresh`) pushed to
`origin/main`.

### Iteration 13 - done (2026-06-09)

**Goal:** Remove the unused `@fontsource-variable/inter` dependency.

**Rationale:** The active font stack imports Geist, Geist Mono, JetBrains Mono, and
Source Serif 4 in `src/styles.css`. `AGENTS.md` documents those same font roles,
and a repo-wide search found no Inter import or token usage. Removing the unused
font package trims dependency metadata and lockfile weight without changing the
rendered theme.

**Docs checked:** pnpm docs for removing dependencies. `pnpm remove` updates
`package.json` and `pnpm-lock.yaml` together.

**Claimed files:**
- `package.json`
- `pnpm-lock.yaml`

**Verification plan:**
- Search: confirm no `@fontsource-variable/inter` / Inter references remain.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm remove @fontsource-variable/inter` removed one package.
- `rg -n "@fontsource-variable/inter|Inter Variable|\\bInter\\b" package.json pnpm-lock.yaml src docs AGENTS.md README.md`
  returned no matches.
- `pnpm test` passed (50 files, 316 tests; Claude's in-progress
  `src/statusLabels.test.ts` was present in the shared worktree).
- `pnpm build` passed.

**Commit:** `21a1941`
(`chore(deps): remove unused inter font package`) pushed to `origin/main`.

### Iteration 14 - in progress (2026-06-09)

**Goal:** Add coverage for the JIRA visual helper components.

**Rationale:** `jiraVisuals.tsx` carries deterministic UI semantics for issue
type normalization, priority labels, and assignee avatar initials/unassigned
state. Those helpers are pure render logic used by the JIRA board, but had no
focused tests.

**Docs checked:** Testing Library docs for accessible queries. The tests use
`getByLabelText` / title assertions instead of implementation-specific DOM
selectors.

**Claimed files:**
- `src/components/jiraVisuals.test.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/components/jiraVisuals.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified; committing.

**Evidence:**
- `pnpm vitest run src/components/jiraVisuals.test.tsx` passed (4 tests).
- `pnpm test` passed (51 files, 320 tests).
- `pnpm build` passed.

---

## Backlog / future work

- Audit remaining custom async/loading hooks against the Query/Zustand ownership
  boundary.
- Inspect large files only where a real cohesion split is visible:
  `src/AppRouter.tsx`, `native/src/sessions/mod.rs`, and `native/src/lib.rs`.
- Re-check terminal decoding docs against the recent UTF-8 boundary fixes.
