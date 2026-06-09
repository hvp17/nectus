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

- Claude and Codex share one checkout and one index. Always commit by explicit
  pathspec after re-reading `CLAUDE_ROLLING_UPDATES.md`.
- Claude iteration 1 owned unused `@tanstack/react-router` removal:
  `package.json`, `pnpm-lock.yaml`, and `AGENTS.md`; it landed as `4b3fc06`.
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

**Status:** verified and committed on top of Claude's dependency cleanup commit
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

**Status:** verified and committed.

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

**Status:** verified and committed.

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

**Status:** verified and committed.

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

**Status:** verified and committed.

**Evidence:**
- Red: `pnpm vitest run src/queries/jira.test.tsx` failed because a no-project
  query allocated `["jira", "project-statuses", ""]`.
- Green: `pnpm vitest run src/queries/jira.test.tsx` passed (1 test).
- `pnpm build` passed.
- `pnpm test` passed (47 files, 297 tests).

**Commit:** `7a55820`
(`refactor(jira): skip idle project status sentinel`) pushed to `origin/main`.

### Iteration 8 - done (2026-06-09)

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

### Iteration 14 - done (2026-06-09)

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

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/jiraVisuals.test.tsx` passed (4 tests).
- `pnpm test` passed (51 files, 320 tests).
- `pnpm build` passed.

**Commit:** `a260a7b` (`test(jira): cover visual helper labels`) pushed to
`origin/main`.

### Iteration 15 - done (2026-06-09)

**Goal:** Add coverage for terminal theme token resolution and cleanup.

**Rationale:** `readTerminalTheme` is shared by the live terminal and review
terminal. It creates a hidden probe, resolves CSS token colors into concrete xterm
theme strings, and removes the probe. That DOM side effect had no focused test.

**Docs checked:** jsdom docs for visual-browser limitations and `getComputedStyle`.
Because jsdom does not implement full layout/rendering, the test stubs
`getComputedStyle` and asserts the function's token mapping and DOM cleanup.

**Claimed files:**
- `src/lib/terminalTheme.test.ts`

**Verification plan:**
- Focused: `pnpm vitest run src/lib/terminalTheme.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/lib/terminalTheme.test.ts` passed (1 test).
- `pnpm test` passed (52 files, 321 tests).
- `pnpm build` passed.

**Commit:** `a5d9fb5` (`test(terminal): cover theme token resolution`) pushed to
`origin/main`.

### Iteration 16 - done (2026-06-09)

**Goal:** Add focused coverage for the external-link opener helper.

**Rationale:** `openExternal` is the shared path for PR, JIRA, review, and
terminal web links. It delegates to `api.openExternalUrl` and surfaces a toast
when the Tauri opener fails, but the helper itself has no focused test for the
success or async failure paths.

**Docs checked:** Tauri 2 opener plugin docs for `openUrl`; the plugin opens URLs
in the default browser and `opener:default` includes `allow-open-url` plus the
default `http://` and `https://` URL scope.

**Claimed files:**
- `src/lib/openExternal.test.ts`

**Verification plan:**
- Focused: `pnpm vitest run src/lib/openExternal.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/lib/openExternal.test.ts` passed (2 tests).
- `pnpm test` passed (53 files, 323 tests).
- `pnpm build` passed.

**Commit:** `a4bdd32` (`test(links): cover external opener helper`) pushed to
`origin/main`.

### Iteration 17 - done (2026-06-09)

**Goal:** Cover session-notification guard and failure branches.

**Rationale:** `notifySessionEvent` is the event-bridge path that turns completed
or blocked agent activity into system notifications. Existing coverage only checks
happy-path body truncation, leaving the non-Tauri guard, permission-denied warning,
and send-failure logging branches untested.

**Docs checked:** Tauri 2 notification plugin docs for permission checks and
`sendNotification`; the documented frontend flow checks permission, requests it
when needed, and skips sending when permission is not granted.

**Claimed files:**
- `src/sessionNotifications.test.ts`

**Verification plan:**
- Focused: `pnpm vitest run src/sessionNotifications.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/sessionNotifications.test.ts` passed (4 tests).
- `pnpm test` passed (54 files, 331 tests; includes the parallel agent's
  untracked `src/hooks/useGuardedAction.test.ts` in the shared worktree).
- `pnpm build` passed.

**Commit:** `69ee1f6` (`test(notifications): cover session send fallbacks`)
pushed to `origin/main`.

### Iteration 18 - done (2026-06-09)

**Goal:** Cover API-level opener and notification permission branches.

**Rationale:** Component and utility tests cover link-opening call sites, but the
`api` layer itself still has untested branches for browser fallback URL opening,
Tauri opener delegation, notification permission prompting, and denied-permission
short-circuiting.

**Docs checked:** Tauri 2 plugin docs for `openUrl` and `sendNotification`.
`opener:default` covers default `http://` and `https://` URL opening, while the
notification flow checks permission, requests it if needed, and skips sending
when permission is not granted.

**Claimed files:**
- `src/api.test.ts`

**Verification plan:**
- Focused: `pnpm vitest run src/api.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/api.test.ts` passed (19 tests).
- `pnpm test` passed (55 files, 338 tests).
- `pnpm build` passed.

**Commit:** `fbd1f61` (`test(api): cover opener and notification permissions`)
pushed to `origin/main`.

### Iteration 19 - done (2026-06-09)

**Goal:** Add focused coverage for session command task-state updates.

**Rationale:** `useSessionCommands` owns the app-shell contract for starting,
resuming, stopping, and clearing sessions in the task cache. It has no focused
hook test, so regressions in agent-profile selection or `activeSessionId` /
resumable session metadata updates would only be caught indirectly.

**Docs checked:** Testing Library React docs for `renderHook` and wrapping async
hook updates in `act`.

**Claimed files:**
- `src/hooks/useSessionCommands.test.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/hooks/useSessionCommands.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useSessionCommands.test.tsx` passed (4 tests).
- `pnpm test` passed (57 files, 345 tests; includes the parallel agent's
  untracked `src/hooks/useTaskDeletion.test.tsx` in the shared worktree).
- `pnpm build` passed.

**Commit:** `e757c9c` (`test(sessions): cover session command updates`) pushed to
`origin/main`.

### Iteration 20 - done (2026-06-09)

**Goal:** Add focused coverage for session attention clearing wrappers.

**Rationale:** `useSessionAttentionControls` is the bridge between session
commands and the attention store. It clears stale `needs_input` / idle attention
when the user starts, resumes, stops, exits, or types into a matching session, but
that wrapper behavior has no focused tests.

**Docs checked:** Testing Library React docs for `renderHook` and `act` around
hook callbacks that update state.

**Claimed files:**
- `src/hooks/useSessionAttentionControls.test.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx` passed (5
  tests).
- `pnpm test` passed (58 files, 350 tests).
- `pnpm build` passed.

**Commit:** `825c3b3` (`test(sessions): cover attention clearing controls`)
pushed to `origin/main`.

### Iteration 21 - done (2026-06-09)

**Goal:** Remove the obsolete command-redesign working tracker.

**Rationale:** `docs/command-redesign-plan.md` is a branch-era rollout tracker
that says it should be folded into permanent docs or deleted once the redesign
lands. It is not referenced by the docs index, and it now contains stale
historical verification counts, so keeping it in the live docs tree creates
avoidable drift.

**Docs checked:** Diataxis reference guidance for concise, orderly, current
reference material; this reinforces keeping the indexed docs as the authoritative
current surface instead of carrying obsolete branch trackers beside them.

**Claimed files:**
- `docs/command-redesign-plan.md`

**Verification plan:**
- Search: confirm no references to `command-redesign-plan.md` remain.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "command-redesign-plan|Command Redesign|1026 tests|1026/1026" README.md AGENTS.md docs src native`
  returned no matches.
- `pnpm test` passed (58 files, 350 tests).
- `pnpm build` passed.

**Commit:** `7362e81` (`docs: remove obsolete command redesign tracker`) pushed
to `origin/main`.

### Iteration 22 - done (2026-06-09)

**Goal:** Cover the JIRA REST token cache/update hook.

**Rationale:** `useJiraToken` is the Settings-side path for connecting and
disconnecting the optional JIRA REST API token. It updates the REST status cache,
invalidates the status after disconnect, and re-reads settings so later saves do
not clobber the non-secret JIRA account fields. That cache contract has no focused
test.

**Docs checked:** TanStack Query v5 docs for `queryClient.setQueryData` and
`invalidateQueries` after successful mutations.

**Claimed files:**
- `src/hooks/useJiraToken.test.tsx`

**Verification plan:**
- Focused: `pnpm vitest run src/hooks/useJiraToken.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useJiraToken.test.tsx` passed (2 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `055850d` (`test(jira): cover token cache updates`) pushed to
`origin/main`.

### Iteration 23 - done (2026-06-09)

**Goal:** Remove the obsolete CSS-system rework tracker from the live docs tree.

**Rationale:** `docs/css-system-rework-plan.md` is a branch-era working tracker
that says to fold durable facts into permanent docs and delete the file once the
work lands. It is not referenced by the docs index, contains stale verification
counts from an older test suite shape, and now duplicates project rules already
owned by `AGENTS.md` and the architecture/docs map.

**Docs checked:** Diataxis guidance for keeping reference material factual,
scannable, and current; obsolete rollout trackers should not sit beside the
indexed current docs as if they were authoritative reference pages.

**Claimed files:**
- `docs/css-system-rework-plan.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Search: confirm no references to the CSS tracker remain.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "css-system-rework-plan|CSS System Rework|chore/css-coherence|287 tests|288 tests|45 files|46 files" README.md AGENTS.md docs src native package.json`
  returned no matches.
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `c9bce86` (`docs: remove obsolete css rework tracker`) pushed to
`origin/main`.

### Iteration 24 - done (2026-06-09)

**Goal:** Clean stale coordination statuses from the Codex rolling log.

**Rationale:** The rolling doc is the handoff surface for the parallel-agent loop,
but it still described old committed work as "current", "in progress", or
"committing". That can mislead later iterations into avoiding already-finished
files or misreading the latest pushed state.

**Docs checked:** Official Git `commit` documentation for pathspec behavior. Git
documents that when pathnames are given, the commit records only those named
paths, which matches the shared-checkout rule in this rolling log.

**Claimed files:**
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Search: confirm old coordination/status wording is gone from completed entries.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- Search for obsolete coordination/status phrases returned no matches.
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `0358ad6` (`docs(rolling): clean stale codex coordination status`)
pushed to `origin/main`.

### Iteration 25 - done (2026-06-09)

**Goal:** Make the frontend Tauri runtime check dynamic and simplify API tests.

**Rationale:** `src/api.ts` captured `isTauri` at module load, so tests had to
reset and re-import the whole module to cover Tauri-only branches. A small
`isTauriRuntime()` helper keeps the same Tauri command boundary while removing
that brittle import-order coupling.

**Docs checked:** Context7 Tauri 2 docs for `invoke` from
`@tauri-apps/api/core`, typed promise returns, and JSON argument passing. This
change keeps those documented command-call semantics intact.

**Claimed files:**
- `src/api.ts`
- `src/api.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/api.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/api.test.ts` passed (19 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `a2d7a53` (`refactor(api): check tauri runtime dynamically`) pushed
to `origin/main`.

### Iteration 26 - done (2026-06-09)

**Goal:** Move Tauri runtime detection into a neutral shared helper.

**Rationale:** Generic Tauri event/terminal code imported `isTauriRuntime` from
`sessionNotifications`, coupling unrelated infrastructure to the notification
module. A tiny `src/lib/tauriRuntime.ts` helper keeps runtime detection in one
neutral place and lets notifications, API wrappers, updater code, terminal, and
event hooks depend on the same boundary.

**Docs checked:** Context7 Tauri 2 docs for frontend event `listen`; listeners
return an `UnlistenFn` that should be called when a listener goes out of scope.
The existing hook keeps that cleanup, while the runtime guard moves to a shared
location.

**Claimed files:**
- `src/lib/tauriRuntime.ts`
- `src/api.ts`
- `src/lib/update.ts`
- `src/sessionNotifications.ts`
- `src/TerminalPane.tsx`
- `src/hooks/useTauriEvent.ts`
- `src/hooks/useEventBridge.ts`
- `src/hooks/useTaskDiff.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/api.test.ts src/lib/update.test.ts src/sessionNotifications.test.ts src/hooks/useTaskDiff.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/api.test.ts src/lib/update.test.ts src/sessionNotifications.test.ts src/hooks/useTaskDiff.test.tsx`
  passed (4 files, 36 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `c0313b7` (`refactor(tauri): centralize runtime detection`) pushed
to `origin/main`.

### Iteration 27 - done (2026-06-09)

**Goal:** Keep notification-body formatting in the system notification API
boundary.

**Rationale:** `notifySessionEvent` formatted notification bodies before calling
`api.sendSystemNotification`, and `api.sendSystemNotification` formatted the body
again before sending through the Tauri notification plugin. Formatting belongs at
the platform boundary, so session notifications can pass raw event text and avoid
duplicating truncation/Markdown stripping responsibility.

**Docs checked:** Context7 Tauri 2 notification plugin docs for the documented
permission flow: check permission, request when needed, then send the
notification. The existing API wrapper remains the owner of that plugin-facing
flow and body normalization.

**Claimed files:**
- `src/sessionNotifications.ts`
- `src/sessionNotifications.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/sessionNotifications.test.ts src/api.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/sessionNotifications.test.ts src/api.test.ts` passed (2
  files, 23 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `22b50cc`
(`refactor(notifications): format system body at api boundary`) pushed to
`origin/main`.

### Iteration 28 - done (2026-06-09)

**Goal:** Remove unused step-count bookkeeping from the workflow stepper.

**Rationale:** The local `reui` stepper computes `stepsCount` by walking its
children and stores it in context, but no component reads that field. Removing the
dead context field also removes the child-introspection imports that only existed
for the unused value.

**Docs checked:** Context7 React docs for component purity and composition via
props/children/context. This keeps the stepper context focused on values that
rendering components actually consume.

**Claimed files:**
- `src/components/reui/stepper.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `3061a78` (`refactor(stepper): remove unused step count context`)
pushed to `origin/main`.

### Iteration 29 - done (2026-06-09)

**Goal:** Trim unused workflow stepper subcomponents from the local `reui` file.

**Rationale:** The app only imports the nav/item/trigger/indicator/title/
description pieces of the local stepper. `StepperSeparator`, `StepperPanel`,
`StepperContent`, and the exported hooks are unused outside the file, so keeping
them expands the local API and maintenance surface without serving the current
workflow.

**Docs checked:** Context7 React docs for component composition with props,
children, and context. This keeps the local stepper API aligned to the components
the app actually composes.

**Claimed files:**
- `src/components/reui/stepper.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Search: confirm removed stepper exports have no remaining references.
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "StepperSeparator|StepperPanel|StepperContent|StepperContentProps" src docs README.md AGENTS.md`
  returned no matches.
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `22bcf6d` (`refactor(stepper): remove unused local subcomponents`)
pushed to `origin/main`.

### Iteration 30 - done (2026-06-09)

**Goal:** Remove stale stepper memo dependencies and duplicate context reads.

**Rationale:** After removing `stepsCount`, the stepper context memo no longer
reads `children`, but still included it in the dependency list. The trigger also
called `useStepItem()` twice in one render. Removing both keeps the component
logic aligned to the values it actually reads.

**Docs checked:** Context7 React `useMemo` docs for dependency arrays: include
the reactive values referenced by the calculation so memo work does not re-run
unnecessarily.

**Claimed files:**
- `src/components/reui/stepper.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `a30781b` (`refactor(stepper): simplify memo and context reads`)
pushed to `origin/main`.

### Iteration 31 - done (2026-06-09)

**Goal:** Add cleanup for workflow stepper trigger registration.

**Rationale:** `StepperTrigger` registers its button node for keyboard navigation
but never unregisters it on unmount, and the effect depends on `btnRef.current`.
Making register/unregister explicit keeps the trigger registry accurate if steps
mount/unmount and follows normal effect setup/cleanup structure.

**Docs checked:** Context7 React `useEffect` docs for setup and cleanup: effects
that synchronize with an external system should return cleanup and list the
reactive values they use.

**Claimed files:**
- `src/components/reui/stepper.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `763cb91` (`fix(stepper): clean up trigger registration`) pushed to
`origin/main`.

### Iteration 32 - done (2026-06-09)

**Goal:** Simplify workflow stepper keyboard navigation guards.

**Rationale:** The stepper context defines `focusNext`, `focusPrev`,
`focusFirst`, and `focusLast` as required functions, but `StepperTrigger` still
guards them as optional. Its index memo also depends on `btnRef.current`, which
is not a reactive value. Removing those leftovers keeps the trigger logic
consistent with the context contract.

**Docs checked:** Context7 React `useMemo` docs for dependency arrays: include
the reactive values referenced by the calculation. The trigger index only needs
to update when the registered trigger list changes.

**Claimed files:**
- `src/components/reui/stepper.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (26 tests).
- `pnpm test` passed (59 files, 352 tests).
- `pnpm build` passed.

**Commit:** `61741f0` (`refactor(stepper): simplify keyboard navigation guards`)
pushed to `origin/main`.

### Iteration 33 - done (2026-06-09)

**Goal:** Reuse derived session notification content when creating task toasts.

**Rationale:** `useEventBridge` already derives the raw title/body for
`session_idle` and `session_needs_input` so it can update the no-task fallback
and send the macOS notification. For known tasks it then calls a toast helper
that derives the same content a second time. A small content-to-toast helper keeps
the wording source of truth in `taskNotification.ts` while avoiding duplicated
derivation in the event bridge.

**Docs checked:** Context7 React docs for calculating derived data during render
instead of adding extra synchronization. This change keeps session event content
as a derived value at the event boundary and passes it into the toast conversion.

**Claimed files:**
- `src/taskNotification.ts`
- `src/taskNotification.test.ts`
- `src/hooks/useEventBridge.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/taskNotification.test.ts src/hooks/useEventBridge.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/taskNotification.test.ts src/hooks/useEventBridge.test.tsx`
  passed (2 files, 12 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `0e6a73b` (`refactor(notifications): reuse derived toast content`)
pushed to `origin/main`.

### Iteration 34 - done (2026-06-09)

**Goal:** Remove the unused `silent` option from the update-check hook contract.

**Rationale:** `useAppUpdate.check` accepted an options object with `silent`, but
the hook no longer reads that option. The launch check is still silent by UI
behavior because the app only surfaces update toasts for the resulting state;
there is no separate plugin-level silent flag in the current Tauri updater flow.

**Docs checked:** Context7 Tauri 2 updater docs for the current JavaScript flow:
`check()`, optional update metadata, `downloadAndInstall()`, and `relaunch()`.
The docs expose request options such as proxy/timeout/headers, not a `silent`
option.

**Claimed files:**
- `src/hooks/useAppUpdate.ts`
- `src/hooks/useAppUpdate.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/hooks/useAppUpdate.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useAppUpdate.test.tsx` passed (1 file, 6 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `50a4e04` (`refactor(update): remove unused check options`) pushed
to `origin/main`.

### Iteration 35 - done (2026-06-09)

**Goal:** Lazy-load secondary app views to reduce eager desktop bundle weight.

**Rationale:** `pnpm build` consistently warns that the main JavaScript chunk is
larger than 500 kB. `AppRouter.tsx` eagerly imports Settings, PR Reviews, and
JIRA even though only one view renders at a time. Splitting the secondary rail
views behind `React.lazy` keeps the core mission/board/task shell eager while
letting Vite create async chunks for less-frequent surfaces.

**Docs checked:** Context7 React docs for `lazy` + `Suspense`, and Context7 Vite
v8 docs for dynamic imports and production code splitting. Vite also documents
CSS code splitting for async chunks, so component CSS can follow the lazy view.

**Claimed files:**
- `src/AppRouter.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/App.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/App.test.tsx` passed (1 file, 49 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed and emitted async chunks for `SettingsPage`,
  `ReviewsPage`, and `JiraBoardPage`; the main JS chunk dropped from about
  1,208 kB to 1,160 kB minified. Vite still reports the 500 kB warning, so
  deeper shell/task-workspace chunking remains future work.

**Commit:** `295c2b5` (`perf(router): lazy-load secondary views`) pushed to
`origin/main`.

### Iteration 36 - in progress (2026-06-09)

**Goal:** Lazy-load on-demand shell overlays and the command palette.

**Rationale:** After splitting secondary rail views, `AppRouter.tsx` still eagerly
imports large components that only appear after explicit user action: task
workspace, task composer, workspace manager, and command palette. Moving those
behind the existing viewport `Suspense` boundary, plus a small palette boundary,
keeps the always-visible shell smaller while preserving the core board path.

**Docs checked:** Context7 React docs for conditionally rendered lazy components
under `Suspense`, including user-triggered reveals that show fallback content
until the lazy component is ready.

**Claimed files:**
- `src/AppRouter.tsx`
- `src/test/appTaskCreationTests.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/App.test.tsx src/components/TaskWorkspaceOverlay.test.tsx src/components/CreateTaskComposer.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and ready to commit.

**Evidence:**
- `pnpm vitest run src/App.test.tsx src/components/TaskWorkspaceOverlay.test.tsx src/components/CreateTaskComposer.test.tsx`
  passed (3 files, 51 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed. The main JS chunk dropped from about 1,160 kB to
  482 kB minified; Vite still warns because `TaskWorkspaceOverlay` is now a
  585 kB async chunk.

---

## Backlog / future work

- Audit remaining custom async/loading hooks only when new code introduces a real
  ownership mismatch; the existing high-value hook coverage is mostly harvested.
- Re-check terminal decoding docs against the recent UTF-8 boundary fixes.
- Continue bundle splitting only where a clear route/workflow boundary exists
  (for example task workspace, composer, or command palette) and verify with
  `pnpm build` chunk output.
- Investigate splitting `TaskWorkspaceOverlay` internals (terminal/diff/review
  surfaces) if bundle work continues; it is now isolated as the only warning-size
  async chunk.
- Periodically diff the command/event/table reference against source after
  backend changes.
