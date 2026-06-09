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
- `.claude/` and `design-mockups/` are now intentionally ignored as local
  nested-worktree / design-prototype areas.

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

### Iteration 36 - done (2026-06-09)

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

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/App.test.tsx src/components/TaskWorkspaceOverlay.test.tsx src/components/CreateTaskComposer.test.tsx`
  passed (3 files, 51 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed. The main JS chunk dropped from about 1,160 kB to
  482 kB minified; Vite still warns because `TaskWorkspaceOverlay` is now a
  585 kB async chunk.

**Commit:** `ce99fbc` (`perf(router): lazy-load on-demand overlays`) pushed to
`origin/main`.

### Iteration 37 - done (2026-06-09)

**Goal:** Lazy-load task workspace stage panes to split terminal-heavy code.

**Rationale:** After isolating the task workspace as an async route chunk, Vite's
remaining size warning moved to `TaskWorkspaceOverlay`. Inspection shows
`TaskWorkspaceStage` eagerly imports the live terminal, diff view, and review
terminal even though only one tab is visible. Lazy-loading those active pane
components should keep the task workspace shell responsive while moving xterm and
diff rendering into smaller on-demand chunks.

**Docs checked:** Context7 React docs for conditionally rendered lazy components
under a `Suspense` boundary.

**Claimed files:**
- `src/components/taskWorkspace/TaskWorkspaceStage.tsx`
- `src/components/TaskWorkspace.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (1 file, 26 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed without the previous chunk-size warning.
  `TaskWorkspaceOverlay` dropped from about 585 kB to 51 kB minified, with
  `TerminalPane`, `TaskDiffView`, and `ReviewTerminalPane` emitted as async
  chunks.

**Commit:** `dd6c9de` (`perf(task-workspace): lazy-load stage panes`) pushed to
`origin/main`.

### Iteration 38 - done (2026-06-09)

**Goal:** Update architecture docs for the new lazy-loading boundaries.

**Rationale:** The frontend file map still described `AppRouter` and the task
workspace surfaces as if they were eager imports. The code now lazily loads
secondary views, on-demand overlays, the command palette, and the task workspace
stage panes. The reference docs should mirror that structure so future agents do
not accidentally reintroduce eager imports while working in the shell.

**Docs checked:** Diataxis/reference guidance via web search: reference docs
should be concise, factual, and follow the product architecture they describe.

**Claimed files:**
- `AGENTS.md`
- `docs/architecture.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Review: `rg -n "lazy|Suspense|TaskWorkspaceStage|AppRouter" AGENTS.md docs/architecture.md`.
- No runtime test needed for docs-only changes.

**Status:** verified and committed.

**Evidence:**
- `rg -n "lazy|Suspense|TaskWorkspaceStage|AppRouter" AGENTS.md docs/architecture.md`
  shows the new AppRouter and task-workspace loading-boundary references.
- Runtime tests were not run because this is a docs-only update.

**Commit:** `655ef2e` (`docs: document frontend lazy boundaries`) pushed to
`origin/main`.

### Iteration 39 - done (2026-06-09)

**Goal:** Remove redundant TanStack Query `enabled` flags where `skipToken` already disables the query.

**Rationale:** Several conditional queries use both `queryFn: condition ? fn :
skipToken` and `enabled: condition`. In TanStack Query v5, `skipToken` is the
type-safe conditional query function and disables the query without a separate
`enabled` flag. Keeping both makes the query options noisier and gives future
readers two places to inspect for the same gate.

**Docs checked:** Context7 TanStack Query v5 docs for type-safe disabling with
`skipToken`. The docs show `skipToken` directly in `queryFn` and reserve
`enabled` for ordinary dependent queries or manual-refetch cases.

**Claimed files:**
- `src/queries/github.ts`
- `src/queries/jira.ts`
- `src/hooks/useTaskDiff.ts`
- `src/hooks/useTaskReviewLoop.ts`
- `src/hooks/usePrReviews.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/queries/github.test.tsx src/queries/jira.test.tsx src/hooks/useTaskDiff.test.tsx src/hooks/useTaskReviewLoop.test.tsx src/hooks/usePrReviews.test.ts`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/queries/github.test.tsx src/queries/jira.test.tsx src/hooks/useTaskDiff.test.tsx src/hooks/useTaskReviewLoop.test.tsx src/hooks/usePrReviews.test.ts`
  passed (5 files, 17 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `5dff9a2` (`refactor(queries): rely on skipToken gates`) pushed to
`origin/main`.

### Iteration 40 - done (2026-06-09)

**Goal:** Remove a no-op `useMemo` from `TaskWorkspace`.

**Rationale:** `TaskWorkspace` creates `reviewerProfiles` with
`useMemo(() => agentProfiles, [agentProfiles])`, but that returns the same array
identity it received and does not cache any derived calculation. Using
`agentProfiles` directly removes indirection in the review workflow state.

**Docs checked:** Context7 React `useMemo` docs: memoization is useful for
expensive calculations, memoized props, or hook dependencies, not direct
identity pass-through values.

**Claimed files:**
- `src/components/TaskWorkspace.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskWorkspace.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskWorkspace.test.tsx` passed (1 file, 26 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `a068a98` (`refactor(task-workspace): remove noop memo`) pushed to
`origin/main`.

### Iteration 41 - done (2026-06-09)

**Goal:** Remove unnecessary `useMemo` wrappers from `TaskDiffView`.

**Rationale:** `TaskDiffView` memoized `summary?.files ?? EMPTY_FILES` and a
selected-file `find` result. The file-list expression already returns either the
summary's stable `files` array or the module-level `EMPTY_FILES`; the selected
metadata lookup returns an existing file object. Keeping both wrappers makes the
diff pane harder to read without stabilizing any new object identity or avoiding
an expensive calculation.

**Docs checked:** Context7 React `useMemo` docs: memoization is useful for
noticeably expensive calculations, memoized child props, or values that truly
need stable identity as hook dependencies. These direct reads do not meet that
bar.

**Claimed files:**
- `src/components/TaskDiffView.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/components/TaskDiffView.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/components/TaskDiffView.test.tsx` passed (1 file, 6 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `904fff6` (`refactor(diff): remove unnecessary memo wrappers`) pushed
to `origin/main`.

### Iteration 42 - done (2026-06-09)

**Goal:** Centralize the app-view union and derive narrower navigation view
types from it.

**Rationale:** `navigationSlice.ts` and `taskNavigation.ts` both defined the same
`AppView` union, while `IconRail.tsx` separately defined the rail subset. Keeping
one owner for the top-level view set prevents drift when a view is added or
removed, and deriving the task-surface / rail subsets documents which surfaces
intentionally exclude secondary or workspace views.

**Docs checked:** Context7 TypeScript docs for `import type` and `Exclude`.
Type-only imports keep this refactor out of runtime output, and `Exclude` is the
standard utility for deriving a subset union.

**Claimed files:**
- `src/taskNavigation.ts`
- `src/components/IconRail.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused: `pnpm vitest run src/taskNavigation.test.ts src/App.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/taskNavigation.test.ts src/App.test.tsx` passed (2 files, 55 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `d5b6d1b` (`refactor(navigation): centralize app view types`) pushed
to `origin/main`.

### Iteration 43 - done (2026-06-09)

**Goal:** Remove a dead local from the GitHub read hook.

**Rationale:** A TypeScript unused-symbol audit
(`pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`) found one issue:
`useGithub.ts` declared `selectedTaskId` but never read it. The hook already
passes `selectedTask` into the GitHub query helpers and reads task ids directly
inside `refreshPullRequest`, so the local adds no behavior or clarity.

**Docs checked:** Context7 TypeScript docs for `noUnusedLocals`: TS6133 reports
locals whose values are never read, including write-only locals.

**Claimed files:**
- `src/hooks/useGithub.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Audit: `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`.
- Focused: `pnpm vitest run src/queries/github.test.tsx src/components/TaskWorkspaceOverlay.test.tsx`.
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters` passed.
- `pnpm vitest run src/queries/github.test.tsx src/components/TaskWorkspaceOverlay.test.tsx` passed (2 files, 4 tests).
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed.

**Commit:** `17680ef` (`refactor(github): remove unused selected task id`) pushed
to `origin/main`.

### Iteration 44 - done (2026-06-09)

**Goal:** Promote the successful unused-symbol audit into the standard
TypeScript build gate.

**Rationale:** Iteration 43 showed `noUnusedLocals`/`noUnusedParameters` catches
real dead code and the tree now passes the stricter compiler check. Enabling the
options in `tsconfig.json` keeps future unused locals and parameters from
silently accumulating, and documenting the gate gives future agents the same
expectation before they commit frontend changes.

**Docs checked:** Context7 TypeScript docs for `noUnusedLocals` and
`noUnusedParameters`.

**Claimed files:**
- `tsconfig.json`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Full: `pnpm test`, `pnpm build`.

**Status:** verified and committed.

**Evidence:**
- `pnpm test` passed (59 files, 353 tests).
- `pnpm build` passed with `noUnusedLocals` and `noUnusedParameters` enabled.

**Commit:** `d6449c4` (`chore(types): enforce unused symbol checks`) pushed to
`origin/main`.

### Iteration 45 - done (2026-06-09)

**Goal:** Add the verified Rust Clippy command to the documented verification
gate.

**Rationale:** The frontend now has a stricter unused-symbol compiler gate. The
backend already has a strong `cargo test` gate, but Clippy catches style and
correctness issues that tests can miss. The audit passed cleanly with warnings
denied, so the concrete improvement is to document the same command in the
developer guide and README instead of leaving it as ad hoc knowledge.

**Docs checked:** Context7 Rust Clippy stable docs; `cargo clippy -- -D warnings`
is the relevant local/CI-style gate because warnings become failures.

**Claimed files:**
- `AGENTS.md`
- `README.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Rust lint gate: `cd native && cargo clippy --tests -- -D warnings`.
- Docs check: `rg -n "cargo clippy --tests -- -D warnings" AGENTS.md README.md`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo clippy --tests -- -D warnings` passed.
- `rg -n "cargo clippy --tests -- -D warnings" AGENTS.md README.md` shows the
  gate in both docs.

**Commit:** `a848ca0` (`docs: document rust clippy verification`) pushed to
`origin/main`.

### Iteration 46 - done (2026-06-09)

**Goal:** Apply rustfmt to the backend and document `cargo fmt --check` alongside
the Clippy gate.

**Rationale:** `cargo fmt --check` reported existing formatting drift in the
Rust backend. The right improvement is a mechanical `cargo fmt` pass plus adding
the check command to the same verification docs that now list Clippy, so future
backend changes keep formatting and linting explicit.

**Docs checked:** Context7 had no rustfmt match, so I used the official Cargo
Book `cargo fmt` page and rustfmt repository guidance: `cargo fmt --check`
checks formatting and exits non-zero when rustfmt would change files.

**Claimed files:**
- `native/src/**/*.rs`
- `AGENTS.md`
- `README.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Rust format: `cd native && cargo fmt --check`.
- Rust lint: `cd native && cargo clippy --tests -- -D warnings`.
- Rust tests: `cd native && cargo test`.
- Docs check: `rg -n "cargo fmt --check|cargo clippy --tests -- -D warnings" AGENTS.md README.md`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo fmt --check` passed.
- `cd native && cargo clippy --tests -- -D warnings` passed.
- `cd native && cargo test` passed (240 tests).
- `rg -n "cargo fmt --check|cargo clippy --tests -- -D warnings" AGENTS.md README.md`
  shows both Rust gates in both docs.

**Commit:** `67344d4` (`style(rust): format backend sources`) pushed to
`origin/main`.

### Iteration 47 - done (2026-06-09)

**Goal:** Broaden the documented Clippy gate from test targets to all Cargo
targets.

**Rationale:** Cargo's `--all-targets` covers the library, binaries, tests,
benches, and examples, while `--tests` is narrower. The broader command passes
in this repo, so the documented lint gate should use it to avoid leaving the
Tauri binary target or future examples outside the lint surface.

**Docs checked:** Context7 Cargo Book docs for target selection:
`--all-targets` is equivalent to `--lib --bins --tests --benches --examples`.

**Claimed files:**
- `AGENTS.md`
- `README.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Rust lint: `cd native && cargo clippy --all-targets -- -D warnings`.
- Docs check: `rg -n "cargo clippy --all-targets -- -D warnings" AGENTS.md README.md`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo clippy --all-targets -- -D warnings` passed.
- `rg -n "cargo clippy --all-targets -- -D warnings" AGENTS.md README.md` shows
  the all-target Clippy gate in both docs.

**Commit:** `bd66bd4` (`docs: broaden rust clippy gate`) pushed to `origin/main`.

### Iteration 48 - done (2026-06-09)

**Goal:** Bring the architecture verification snippet in line with the new Rust
format/lint gates.

**Rationale:** After Iterations 45-47, README and AGENTS list `cargo fmt
--check` and `cargo clippy --all-targets -- -D warnings`, but
`docs/architecture.md` still showed only `cargo test` for Rust verification. The
architecture doc is an entry-point reference, so it should point future agents
at the same standard gate instead of drifting.

**Docs checked:** Context7 Cargo Book docs for `--all-targets`, plus the
official rustfmt/Cargo Book guidance from Iteration 46.

**Claimed files:**
- `docs/architecture.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Docs check: `rg -n "cargo fmt --check|cargo clippy --all-targets -- -D warnings" docs/architecture.md AGENTS.md README.md`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "cargo fmt --check|cargo clippy --all-targets -- -D warnings" docs/architecture.md AGENTS.md README.md`
  shows the Rust format and all-target Clippy gates in all three docs.

**Commit:** `c85aeec` (`docs: sync architecture verification gates`) pushed to
`origin/main`.

### Iteration 49 - done (2026-06-09)

**Goal:** Sync the tracking/debugging verification command reference with the new
Rust format and all-target Clippy gates.

**Rationale:** The current verification docs in README, AGENTS, and architecture
were aligned, but `docs/tracking-and-debugging.md` still listed only `cargo test`
under Rust verification commands. That guide owns troubleshooting commands, so
the Rust format and lint gates belong there too.

**Docs checked:** Context7 Cargo Book docs for `--all-targets`, plus the
official rustfmt/Cargo Book guidance from Iteration 46.

**Claimed files:**
- `docs/tracking-and-debugging.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Docs check: `rg -n "cargo fmt --check|cargo clippy --all-targets -- -D warnings" README.md AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "cargo fmt --check|cargo clippy --all-targets -- -D warnings" README.md AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`
  shows the Rust format and all-target Clippy gates in all current verification
  docs.

**Commit:** `0dc281a` (`docs: sync tracking verification gates`) pushed to
`origin/main`.

### Iteration 50 - done (2026-06-09)

**Goal:** Add a single `pnpm verify` script for the standard verification gate
and update docs to point to it.

**Rationale:** The standard gate now spans frontend tests/build plus Rust tests,
formatting, and all-target Clippy. Keeping that as repeated shell snippets makes
future drift likely. A root `pnpm verify` script gives agents and humans one
command while preserving individual commands for focused troubleshooting.

**Docs checked:** Context7 pnpm docs for package scripts: `pnpm run` executes
scripts from `package.json`, `pnpm <script>` is supported when the name does not
conflict with a built-in command, and scripts can call other scripts.

**Claimed files:**
- `package.json`
- `AGENTS.md`
- `README.md`
- `docs/architecture.md`
- `docs/tracking-and-debugging.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Full: `pnpm verify`.
- Docs check: `rg -n "pnpm verify" package.json README.md AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`.

**Status:** verified and committed.

**Evidence:**
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.
- `rg -n "pnpm verify" package.json README.md AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`
  shows the root verification script in every updated verification doc.

**Commit:** `84bd7d4` (`chore: add standard verification script`) pushed to
`origin/main`.

### Iteration 51 - done (2026-06-09)

**Goal:** Simplify root UI providers and remove an unused theme dependency.

**Rationale:** `App` already owns the app-wide `TooltipProvider`, while
`main.tsx` wraps the app in a second one. `AppRouter` already passes the
Nectus-owned setting (`settings?.theme ?? "system"`) into `Toaster`, so
`src/components/ui/sonner.tsx` does not need `next-themes` to derive theme state.
Removing both keeps the root provider graph and dependency set aligned with the
actual app architecture.

**Docs checked:** Context7 shadcn/ui docs for Sonner and Tooltip, Context7 Sonner
docs for the explicit `theme` prop (`"light" | "dark" | "system"`), and Context7
pnpm docs for `pnpm remove`.

**Claimed files:**
- `src/main.tsx`
- `src/components/ui/sonner.tsx`
- `package.json`
- `pnpm-lock.yaml`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused toast tests: `pnpm vitest run src/hooks/useTaskNotificationToast.test.tsx src/hooks/useAppUpdateToast.test.tsx`.
- Full gate: `pnpm verify`.
- Dependency check: `rg -n "next-themes" src package.json pnpm-lock.yaml` and
  `rg -n "TooltipProvider" src/main.tsx src/App.tsx src/AppRouter.tsx src/components/ui/tooltip.tsx`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useTaskNotificationToast.test.tsx src/hooks/useAppUpdateToast.test.tsx`
  passed: 2 files / 8 tests.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.
- `rg -n "next-themes" src package.json pnpm-lock.yaml` returned no matches.
- `rg -n "TooltipProvider" src/main.tsx src/App.tsx src/AppRouter.tsx src/components/ui/tooltip.tsx`
  shows the provider only in `App` and the tooltip primitive export.

**Commit:** `58042af` (`refactor(ui): simplify root providers`) pushed to
`origin/main`.

### Iteration 52 - done (2026-06-09)

**Goal:** Remove the last unnecessary React namespace import from the root entry.

**Rationale:** After Iteration 51, `src/main.tsx` uses the React namespace only
for `React.StrictMode`. The current React docs import `StrictMode` directly from
`react` for root rendering, which keeps the entry file aligned with the API it
actually uses.

**Docs checked:** Context7 React docs for `StrictMode` root rendering examples.

**Claimed files:**
- `src/main.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused type/build check: `pnpm build`.
- Root import check: `rg -n "React\\.StrictMode|import React from" src/main.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm build` passed.
- `rg -n "React\\.StrictMode|import React from" src/main.tsx` returned no
  matches.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `77134e6` (`refactor(ui): simplify react entry import`) pushed to
`origin/main`.

### Iteration 53 - done (2026-06-09)

**Goal:** Consolidate duplicated git worktree creation setup.

**Rationale:** `create_worktree` and `create_worktree_at_ref` both validate the
target path, create its parent folder, run `git worktree add`, and map command
errors. Keeping the path preparation and command execution in small helpers keeps
future worktree behavior changes in one place without changing the public API.

**Docs checked:** Context7 Rust standard library docs for
`std::process::Command` `arg`/`args`/`output` semantics.

**Claimed files:**
- `native/src/git_ops/mod.rs`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused Rust tests: `cd native && cargo test git_ops::tests::`.
- Rust format: `cd native && cargo fmt --check`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo fmt --check` passed.
- `cd native && cargo test git_ops::tests::` passed: 21 tests.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `6dd6f0e` (`refactor(git): share worktree add setup`) pushed to
`origin/main`.

### Iteration 54 - done (2026-06-09)

**Goal:** Centralize production `git -C <repo>` command construction.

**Rationale:** After Iteration 53, the remaining production `git_ops` callers
still rebuild the same `Command::new("git").arg("-C").arg(repo_path)` prefix in
multiple places. A tiny command-builder helper keeps the repo-path handling
consistent while leaving test setup calls alone.

**Docs checked:** Context7 Rust standard library docs for the
`std::process::Command` builder pattern.

**Claimed files:**
- `native/src/git_ops/mod.rs`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused Rust tests: `cd native && cargo test git_ops::tests::`.
- Rust format: `cd native && cargo fmt --check`.
- Production-spawn check: `rg -n "Command::new\\(\"git\"\\)|std::process::Command::new\\(\"git\"\\)" native/src/git_ops/mod.rs native/src/git_ops/diff.rs native/src/lib.rs native/src/db/tests.rs`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo fmt --check` passed after formatting.
- `cd native && cargo test git_ops::tests::` passed: 21 tests.
- `rg -n "Command::new\\(\"git\"\\)|std::process::Command::new\\(\"git\"\\)" native/src/git_ops/mod.rs native/src/git_ops/diff.rs native/src/lib.rs native/src/db/tests.rs`
  shows the production `git_ops` constructor only in `git_command`; the rest are
  test setup calls.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `d0c1ecf` (`refactor(git): centralize repo command builder`) pushed
to `origin/main`.

### Iteration 55 - done (2026-06-09)

**Goal:** Route production git commands through the shared external-CLI resolver.

**Rationale:** `git_ops` now has one production command builder, so it can follow
the project-wide macOS GUI PATH rule: resolve the executable through
`process_util::resolve_executable` and set the child `PATH` to
`process_util::augmented_path`. This keeps git behavior aligned with packaged-app
CLI spawning and documents the new call site in `AGENTS.md`.

**Docs checked:** Context7 Rust standard library docs for `Command::env` and the
child-process environment override behavior.

**Claimed files:**
- `native/src/git_ops/mod.rs`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused Rust tests: `cd native && cargo test git_ops::tests::` and
  `cd native && cargo test process_util::tests::`.
- Rust format/lint: `cd native && cargo fmt --check` and
  `cd native && cargo clippy --all-targets -- -D warnings`.
- Docs/code check: `rg -n "resolve_executable\\(\"git\"\\)|git invocations resolve" native/src/git_ops/mod.rs AGENTS.md`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo fmt --check` passed.
- `cd native && cargo test git_ops::tests::` passed: 21 tests.
- `cd native && cargo test process_util::tests::` passed: 4 tests.
- `cd native && cargo clippy --all-targets -- -D warnings` passed.
- `rg -n "resolve_executable\\(\"git\"\\)|git.*resolve.*resolve_executable|native/src/git_ops/mod.rs" native/src/git_ops/mod.rs AGENTS.md`
  shows the git builder and AGENTS call-site entry.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (240 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `e1e29f4` (`fix(git): resolve git with augmented path`) pushed to
`origin/main`.

### Iteration 56 - done (2026-06-09)

**Goal:** Add regression coverage for the git command builder.

**Rationale:** Iteration 55 moved production git commands onto the shared
external-CLI resolver and augmented PATH. A small non-spawning unit test can lock
that contract by inspecting the built `Command` program, args, and explicit PATH
environment before any future refactor changes it accidentally.

**Docs checked:** Context7 Rust standard library docs for `Command::get_program`,
`Command::get_args`, and `Command::get_envs`.

**Claimed files:**
- `native/src/git_ops/mod.rs`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused Rust test: `cd native && cargo test git_command_uses_resolved_binary_and_augmented_path`.
- Rust format: `cd native && cargo fmt --check`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `cd native && cargo fmt --check` passed.
- `cd native && cargo test git_command_uses_resolved_binary_and_augmented_path`
  passed: 1 test.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `eb66a2e` (`test(git): cover resolved git command builder`) pushed
to `origin/main`.

### Iteration 57 - done (2026-06-09)

**Goal:** Keep local Claude worktrees out of git status.

**Rationale:** The repo already excludes `.claude/` from Vitest because it can
hold full nested worktree copies. Git still reported `.claude/` as an untracked
folder, which adds noise to every selective-staging pass and increases the risk
of accidentally staging local settings or copied worktree files. Ignoring only
`.claude/` aligns git hygiene with the existing test policy while leaving
`design-mockups/` untouched because it has no established local-only rule.

**Docs checked:** Context7 Git docs for `.gitignore` pattern format; trailing
slashes match directories only, and patterns are relative to the `.gitignore`
file location.

**Claimed files:**
- `.gitignore`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Ignore check: `git check-ignore -v .claude .claude/worktrees/opencode`.
- Status check: `git status --short --branch` should no longer list `.claude/`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `git check-ignore -v .claude .claude/worktrees/opencode` shows both paths
  matched by `.gitignore:7:.claude/`.
- `git status --short --branch` no longer lists `.claude/`; only the existing
  untracked `design-mockups/` remains outside this change.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `c115ffd` (`chore: ignore local claude worktrees`) pushed to
`origin/main`.

### Iteration 58 - done (2026-06-09)

**Goal:** Exclude local Claude worktrees from the Vite dev-server watcher too.

**Rationale:** Iteration 57 aligned git status with the existing Vitest exclude,
but `vite.config.ts` still only ignored `native/` for the dev-server watcher.
Since `.claude/worktrees/*` can contain full repo copies, watching them can
create unnecessary file-system churn during `pnpm dev`. A shared glob keeps the
dev watcher and test exclude in sync.

**Docs checked:** Context7 Vite v8 docs for `server.watch.ignored`, which is
merged with Vite's default ignored list, and Context7 Vitest v4.1.6 docs for
extending `test.exclude` with `configDefaults.exclude`.

**Claimed files:**
- `vite.config.ts`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Type/build check: `pnpm build`.
- Full gate: `pnpm verify`.
- Config check: `rg -n "localWorktreeIgnore|\\.claude" vite.config.ts AGENTS.md`.

**Status:** verified and committed.

**Evidence:**
- `rg -n "localWorktreeIgnore|\\.claude" vite.config.ts AGENTS.md CODEX_ROLLING_UPDATES.md`
  shows the shared Vite/Vitest glob, AGENTS local-worktree policy, and rolling
  doc entries.
- `pnpm build` passed.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `a61e7c8` (`chore: ignore claude worktrees in vite watcher`) pushed
to `origin/main`.

### Iteration 59 - done (2026-06-09)

**Goal:** Treat local design prototypes as scratch artifacts.

**Rationale:** The untracked `design-mockups/README.md` says the prototype bundle
is scratch/exploration and not committed unless requested. Since it contains a
self-contained HTML prototype and screenshots outside the real app source, git
status and Vite/Vitest should treat it the same way: local reference material
that does not participate in normal commits, dev-server watching, or test scans.

**Docs checked:** Context7 Git docs for directory-only `.gitignore` patterns and
Context7 Vite/Vitest docs for extending watcher/test exclude lists without
replacing defaults.

**Claimed files:**
- `.gitignore`
- `vite.config.ts`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Ignore check: `git check-ignore -v design-mockups design-mockups/index.html`.
- Config check: `rg -n "localArtifactIgnores|design-mockups|\\.claude" vite.config.ts AGENTS.md .gitignore`.
- Type/build check: `pnpm build`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `git check-ignore -v design-mockups design-mockups/index.html .claude .claude/worktrees/opencode`
  shows `.gitignore` matches both local artifact roots.
- `rg -n "localArtifactIgnores|design-mockups|\\.claude" vite.config.ts AGENTS.md .gitignore CODEX_ROLLING_UPDATES.md`
  shows the shared Vite/Vitest ignore list, gitignore entries, AGENTS policy,
  and rolling doc.
- `git status --short --branch` now lists only the four intended tracked edits.
- `pnpm build` passed.
- `pnpm verify` passed: frontend tests (59 files / 353 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `563d690` (`chore: ignore local design prototypes`) pushed to
`origin/main`.

### Iteration 60 - done (2026-06-09)

**Goal:** Cover explicit app theme and density application.

**Rationale:** `useAppTheme` only had a regression test for system-theme media
query changes. The hook also applies explicit light/dark mode and the
`data-density` attribute from settings; both are user-visible settings and
should be locked down with focused hook tests.

**Docs checked:** Context7 React docs for `useEffect` dependency behavior: effects
run on mount and when dependencies change, with cleanup on unmount or before the
next dependency change.

**Claimed files:**
- `src/hooks/useAppTheme.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/hooks/useAppTheme.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useAppTheme.test.tsx` passed: 1 file / 3 tests.
- `pnpm verify` passed: frontend tests (59 files / 355 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `048d7f7` (`test(ui): cover explicit theme settings`) pushed to
`origin/main`.

### Iteration 61 - done (2026-06-09)

**Goal:** Cover system-theme listener cleanup in the app theme hook.

**Rationale:** The hook subscribes to the browser color-scheme media query only
while the app theme is set to `system`. The existing test proved the change event
updates the `dark` class, but it did not prove the listener is removed when the
setting leaves `system` or when the component unmounts. The React effect contract
makes that cleanup path important because settings changes re-run the effect.

**Docs checked:** Context7 React docs for `useEffect` setup/cleanup behavior when
dependencies change and when a component unmounts.

**Claimed files:**
- `src/hooks/useAppTheme.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/hooks/useAppTheme.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/hooks/useAppTheme.test.tsx` passed: 1 file / 5 tests.
- `pnpm verify` passed: frontend tests (59 files / 357 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `d65a065` (`test(ui): cover theme listener cleanup`) pushed to
`origin/main`.

### Iteration 62 - done (2026-06-09)

**Goal:** Avoid unnecessary system color-scheme queries for explicit themes.

**Rationale:** `useAppTheme` currently calls `window.matchMedia` on every effect
run, even when the user has selected explicit `light` or `dark` mode. That keeps
the code coupled to a browser system-theme API for states that do not need it.
Branching by theme first makes the hook simpler: explicit themes synchronously
toggle the root class, while only `system` mode reads and subscribes to
`prefers-color-scheme`.

**Docs checked:** Context7 React docs for effects that synchronize with external
browser APIs using setup/cleanup, and cleanup on dependency changes/unmount.

**Claimed files:**
- `src/hooks/useAppTheme.ts`
- `src/hooks/useAppTheme.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: `pnpm vitest run src/hooks/useAppTheme.test.tsx` should fail on the
  new explicit-theme `matchMedia` expectation before production code changes.
- Focused green test: `pnpm vitest run src/hooks/useAppTheme.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppTheme.test.tsx` failed as expected:
  explicit dark mode still called `matchMedia("(prefers-color-scheme: dark)")`
  once.
- Focused green test `pnpm vitest run src/hooks/useAppTheme.test.tsx` passed:
  1 file / 6 tests.
- `pnpm verify` passed: frontend tests (59 files / 358 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `5b01f16` (`refactor(ui): avoid explicit theme media query`) pushed
to `origin/main`.

### Iteration 63 - done (2026-06-09)

**Goal:** Cover the Tauri event helper's async cleanup and error contract.

**Rationale:** `useTauriEvent` is the shared frontend wrapper around Tauri's
`listen` API. Its comment promises two important lifecycle guarantees: if the
component unmounts before `listen()` resolves, the late unlisten callback is
called immediately, and rejected subscriptions surface through `onError` while
mounted. Those are exactly the memory-leak/error-surfacing edges the helper was
created to centralize, but the current tests cover only the already-resolved
unmount path and the latest-handler path.

**Docs checked:** Context7 Tauri v2 event docs for `listen`: it returns an
unlisten function, and that function must be called when the listener goes out of
scope, such as when a component unmounts.

**Claimed files:**
- `src/hooks/useTauriEvent.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/hooks/useTauriEvent.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Initial full `pnpm verify` caught a TypeScript-only issue in the deferred
  `listen()` mock shape; the mock now returns the same unlisten spy type as the
  shared hoisted mock.
- `pnpm vitest run src/hooks/useTauriEvent.test.tsx` passed: 1 file / 7 tests.
- `pnpm verify` passed: frontend tests (59 files / 360 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `a14f327` (`test(ui): cover tauri event listener edges`) pushed to
`origin/main`.

### Iteration 64 - done (2026-06-09)

**Goal:** Centralize the event bridge subscriptions on `useTauriEvent`.

**Rationale:** `useEventBridge` still hand-rolls the async `listen()` lifecycle
that `useTauriEvent` now covers directly: disposed guards, late unlisten cleanup,
and subscription error handling. It also registers the bridge listeners
sequentially, so a failed first subscription prevents later event channels from
being registered. Moving each bridge channel to the shared hook should reduce
duplicated lifecycle code and make subscription failures independent.

**Docs checked:** Context7 Tauri v2 event docs for `listen`/unlisten lifecycle,
plus the existing `useTauriEvent` tests that now cover late cleanup and error
surfacing.

**Claimed files:**
- `src/hooks/useEventBridge.ts`
- `src/hooks/useEventBridge.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: focused bridge test should fail before production refactor when the
  first `listen()` call rejects and later event channels are not registered.
- Focused green test: `pnpm vitest run src/hooks/useEventBridge.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useEventBridge.test.tsx` failed as
  expected: after `session_idle` subscription rejected, `session_activity` was
  not registered.
- Focused green test `pnpm vitest run src/hooks/useEventBridge.test.tsx` passed:
  1 file / 6 tests.
- Neighbor check `pnpm vitest run src/hooks/useTauriEvent.test.tsx src/hooks/useEventBridge.test.tsx`
  passed: 2 files / 13 tests.
- `pnpm verify` passed: frontend tests (59 files / 361 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `ef7b2e5` (`refactor(ui): centralize event bridge subscriptions`)
pushed to `origin/main`.

### Iteration 65 - done (2026-06-09)

**Goal:** Sync docs for the event bridge subscription refactor.

**Rationale:** Iteration 64 changed frontend architecture by moving every
`useEventBridge` event channel onto the shared `useTauriEvent` lifecycle helper.
The code was verified and pushed, but the project guide and event architecture
docs still described the bridge only as a monolithic subscriber. The docs should
now state that the bridge remains the single routing owner while `useTauriEvent`
owns per-channel `listen` cleanup and subscription error handling.

**Docs checked:** Local authoritative docs map in `AGENTS.md`, plus Context7
Tauri v2 docs already fetched for the `listen`/unlisten contract in the preceding
iterations.

**Claimed files:**
- `AGENTS.md`
- `docs/architecture.md`
- `docs/tracking-and-debugging.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Docs grep:
  `rg -n "useTauriEvent|single, mount-once bridge|subscription" AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Docs grep `rg -n "useTauriEvent|single, mount-once bridge|subscription" AGENTS.md docs/architecture.md docs/tracking-and-debugging.md`
  shows the updated event-bridge ownership in all three docs.
- `pnpm verify` passed: frontend tests (59 files / 361 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `446929c` (`docs: sync event bridge architecture`) pushed to
`origin/main`.

### Iteration 66 - done (2026-06-09)

**Goal:** Cover TerminalPane's core Tauri session event paths.

**Rationale:** `TerminalPane` intentionally keeps the terminal stream outside the
mount-once event bridge because it owns xterm instances and per-session terminal
buffers. Existing tests cover setup, input, drag/drop, snapshot replay, and
links, but not the two direct Tauri event handlers: `session_output` writing live
output to the matching terminal, and `session_exited` writing the stopped line,
disposing the cached terminal, and notifying the shell. Locking these down makes
any later listener-lifecycle refactor safer.

**Docs checked:** Context7 Tauri v2 event docs for `listen`/unlisten lifecycle
from the preceding event-listener iterations; local TerminalPane code owns the
xterm-specific behavior.

**Claimed files:**
- `src/TerminalPane.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/TerminalPane.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/TerminalPane.test.tsx` passed: 1 file / 10 tests.
- `pnpm verify` passed: frontend tests (59 files / 363 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `c992454` (`test(ui): cover terminal session events`) pushed to
`origin/main`.

### Iteration 67 - done (2026-06-09)

**Goal:** Reuse `useTauriEvent` for TerminalPane session events.

**Rationale:** TerminalPane must keep terminal-stream handling outside the
mount-once bridge, but its `session_output` and `session_exited` subscriptions
still duplicated the same async `listen().then(unlisten)` cleanup pattern that
`useTauriEvent` now owns. Iteration 66 added focused coverage for those two event
paths, so the listener lifecycle can be centralized while keeping drag/drop,
resize, theme observation, and terminal disposal in the existing terminal setup
effect.

**Docs checked:** Context7 Tauri v2 event docs for the `listen`/unlisten
lifecycle, and the local `useTauriEvent` contract/tests.

**Claimed files:**
- `src/TerminalPane.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/TerminalPane.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/TerminalPane.test.tsx` passed: 1 file / 10 tests.
- `pnpm verify` passed: frontend tests (59 files / 363 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `635f6d8` (`refactor(ui): reuse tauri event hook in terminal`) pushed
to `origin/main`.

### Iteration 68 - done (2026-06-09)

**Goal:** Simplify TerminalPane's remaining drag/drop unlisten bookkeeping.

**Rationale:** After Iteration 67 moved `session_output` and `session_exited` to
`useTauriEvent`, the terminal setup effect had only one async unlisten callback
left: the webview drag/drop listener. Replacing the leftover callback array with
a single `unlistenDragDrop` slot keeps the effect aligned with its actual
ownership while preserving the same late-resolution cleanup behavior.

**Docs checked:** Context7 Tauri v2 event docs for unlisten cleanup from the
preceding listener iterations; this change is a local simplification with no
user-visible behavior change.

**Claimed files:**
- `src/TerminalPane.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/TerminalPane.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- `pnpm vitest run src/TerminalPane.test.tsx` passed: 1 file / 10 tests.
- `pnpm verify` passed: frontend tests (59 files / 363 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `4261125` (`refactor(ui): simplify terminal drag cleanup`) pushed to
`origin/main`.

### Iteration 69 - done (2026-06-09)

**Goal:** Cover TerminalPane's late-resolving drag/drop unlisten cleanup.

**Rationale:** Iteration 68 simplified the webview drag/drop cleanup to one
`unlistenDragDrop` slot while preserving the `disposed` branch for the case where
Tauri resolves `onDragDropEvent()` after React has unmounted the pane. Existing
tests covered normal file-drop behavior but did not prove that late cleanup still
calls the unlisten function. This adds a focused race test so the custom
drag/drop lifecycle remains protected even though the generic Tauri event
subscriptions now use `useTauriEvent`.

**Docs checked:** Context7 `/websites/v2_tauri_app` docs for
`getCurrentWebview().onDragDropEvent()`, which confirm it returns
`Promise<UnlistenFn>` and the unlisten function must be called when the handler
goes out of scope, such as component unmount.

**Claimed files:**
- `src/TerminalPane.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily remove the `disposed` cleanup branch and run
  `pnpm vitest run src/TerminalPane.test.tsx`; the new test should fail because
  the delayed unlisten is not called.
- Focused green test: restore production code and run
  `pnpm vitest run src/TerminalPane.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/TerminalPane.test.tsx` failed as expected with
  `expected "vi.fn()" to be called 1 times, but got 0 times` after temporarily
  removing the late-cleanup branch.
- Focused green `pnpm vitest run src/TerminalPane.test.tsx` passed: 1 file /
  11 tests.
- `pnpm verify` passed: frontend tests (59 files / 364 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `5e79481` (`test(ui): cover terminal drag cleanup race`) pushed to
`origin/main`.

### Iteration 70 - done (2026-06-09)

**Goal:** Make ReviewTerminalPane output replay prefix-aware.

**Rationale:** `ReviewTerminalPane` previously tracked only the number of
characters written to xterm. That preserves the hot path for append-only live
review output, but it can mix stale and new content when the pane receives a
different recorded review output of the same length, or a longer replacement
that is not an append. The fix extracts a tiny pure
`reviewTerminalOutputDelta(renderedOutput, nextOutput)` helper: append the suffix
when the next output still has the rendered prefix; otherwise reset the terminal
and replay the replacement.

**Docs checked:** Context7 `/websites/xtermjs` docs for `Terminal.write()` and
`Terminal.dispose()`, confirming `write()` is the append API and terminal writes
are buffered asynchronously. The component keeps the existing xterm reset call
for replacement replay and only changes the delta decision.

**Claimed files:**
- `src/components/ReviewTerminalPane.tsx`
- `src/lib/reviewTerminalOutput.ts`
- `src/lib/reviewTerminalOutput.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: `pnpm vitest run src/lib/reviewTerminalOutput.test.ts` fails before
  the helper exists.
- Focused green test: `pnpm vitest run src/lib/reviewTerminalOutput.test.ts`.
- Nearby tests:
  `pnpm vitest run src/lib/reviewTerminalOutput.test.ts src/components/TaskWorkspace.test.tsx src/components/TaskWorkspaceOverlay.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/lib/reviewTerminalOutput.test.ts` failed as
  expected because `./reviewTerminalOutput` did not exist.
- Focused green `pnpm vitest run src/lib/reviewTerminalOutput.test.ts` passed:
  1 file / 4 tests.
- Nearby tests
  `pnpm vitest run src/lib/reviewTerminalOutput.test.ts src/components/TaskWorkspace.test.tsx src/components/TaskWorkspaceOverlay.test.tsx`
  passed: 3 files / 31 tests.
- `pnpm verify` passed: frontend tests (60 files / 368 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `8d132ba` (`fix(ui): reset replaced review output`) pushed to
`origin/main`.

### Iteration 71 - done (2026-06-09)

**Goal:** Cover the live review-output event stream.

**Rationale:** After making `ReviewTerminalPane` replacement-aware, the source
hook feeding it still lacked focused tests for the `review_output` event stream.
`useTaskReviewLoop` has three small but important behaviors: stream chunks for
the selected task, replace the buffer when a new run starts at offset `0`, and
ignore events for other tasks. Locking these down protects the read-only Review
pane without changing production code.

**Docs checked:** Context7 `/websites/v2_tauri_app` docs for the frontend
`listen()` API, confirming event handlers receive an object with `payload` and
the listener returns an unlisten function. The tests use the existing
`useTauriEvent` mock path and fire `{ payload: ... }` events directly.

**Claimed files:**
- `src/hooks/useTaskReviewLoop.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily change the hook to always append chunks and run
  `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx`; the offset-zero test
  should fail.
- Focused green test: restore production hook and run
  `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` failed as
  expected with `old outputnew output` instead of `new output` after temporarily
  changing offset-zero handling to append.
- Focused green `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` passed:
  1 file / 6 tests.
- `pnpm verify` passed: frontend tests (60 files / 371 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `e7d3b43` (`test(ui): cover live review output stream`) pushed to
`origin/main`.

### Iteration 72 - done (2026-06-09)

**Goal:** Cover live review-output reset effects.

**Rationale:** `useTaskReviewLoop` intentionally clears the ephemeral
`liveReviewOutput` buffer when the selected task changes and when the selected
task's review loop enters `reviewing` for a new run. Those resets prevent stale
review output from appearing in another task or run. Iteration 71 covered chunk
streaming; this iteration covers the two dependency-driven reset effects.

**Docs checked:** Context7 `/reactjs/react.dev` docs for `useEffect`
dependencies, confirming effects run on mount and whenever listed dependencies
change. This hook intentionally uses those effects to synchronize ephemeral
selected-task/run output.

**Claimed files:**
- `src/hooks/useTaskReviewLoop.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily disable the selected-task reset effect and run
  `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx`; the selected-task
  reset test should fail.
- Focused green test: restore the effect and run
  `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` failed as
  expected because `task 21 output` stayed visible after switching to task 22.
- Focused green `pnpm vitest run src/hooks/useTaskReviewLoop.test.tsx` passed:
  1 file / 8 tests.
- `pnpm verify` passed: frontend tests (60 files / 373 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `fa83354` (`test(ui): cover review output resets`) pushed to
`origin/main`.

### Iteration 73 - done (2026-06-09)

**Goal:** Tighten app-store task-attention fixtures.

**Rationale:** `src/store/appStore.test.ts` used `as never` casts and an invalid
`"finished"` attention kind to exercise `setTaskAttention`. The real
`TaskAttention.kind` contract is `"idle" | "needs_input"`, so the cast hid the
store shape in a central state test. Replacing those fixtures with
`satisfies TaskAttention` keeps the test readable while making TypeScript check
the actual contract.

**Docs checked:** Context7 `/microsoft/typescript` docs for the `satisfies`
operator, confirming it validates object literals against a target type while
preserving the expression's useful literal type.

**Claimed files:**
- `src/store/appStore.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/store/appStore.test.ts`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/store/appStore.test.ts` passed: 1 file /
  5 tests.
- `pnpm verify` passed: frontend tests (60 files / 373 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `1c0f5eb` (`test(ui): type app store attention fixtures`) pushed to
`origin/main`.

### Iteration 74 - done (2026-06-09)

**Goal:** Tighten task-notification TaskSummary fixtures.

**Rationale:** `src/taskNotification.test.ts` used a double cast
`as unknown as TaskSummary` over a partial task object. That bypassed the real
required fields (`repoId`, `status`, `hasWorktree`, `isDirty`, `taskRepos`,
timestamps) in a test for notification text that is task-contract dependent.
Replacing it with a base fixture that `satisfies TaskSummary` keeps overrides
ergonomic while letting TypeScript validate the fixture.

**Docs checked:** Context7 `/microsoft/typescript` docs for the `satisfies`
operator, reused from Iteration 73 because this is the same fixture-typing
pattern.

**Claimed files:**
- `src/taskNotification.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/taskNotification.test.ts`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/taskNotification.test.ts` passed: 1 file /
  7 tests.
- `pnpm verify` passed: frontend tests (60 files / 373 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `bcab60a` (`test(ui): type task notification fixture`) pushed to
`origin/main`.

### Iteration 75 - done (2026-06-09)

**Goal:** Narrow the updater install surface.

**Rationale:** The app only needs the Tauri updater object's
`downloadAndInstall` method after `checkForUpdate()`, but `UpdateCheckResult`
previously exposed the full plugin `Update` type. Tests had to cast partial
objects with `as never`. Introducing `InstallableUpdate =
Pick<Update, "downloadAndInstall">` keeps `checkForUpdate()` compatible with the
real plugin result while making the UI wrapper's public install contract match
what the app actually uses.

**Docs checked:** Context7 `/websites/v2_tauri_app` updater docs for the
`check()` result and `update.downloadAndInstall()` progress-event flow.

**Claimed files:**
- `src/lib/update.ts`
- `src/lib/update.test.ts`
- `src/hooks/useAppUpdate.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused tests:
  `pnpm vitest run src/lib/update.test.ts src/hooks/useAppUpdate.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green
  `pnpm vitest run src/lib/update.test.ts src/hooks/useAppUpdate.test.tsx`
  passed: 2 files / 12 tests.
- Initial `pnpm verify` caught the remaining boundary mismatch:
  `useAppUpdate.ts` still stored the pending update as the full plugin `Update`
  type. Root cause fixed by typing that ref as `InstallableUpdate`.
- `pnpm build` passed after the hook type fix.
- `pnpm verify` passed: frontend tests (60 files / 373 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `9866466` (`refactor(ui): narrow updater install type`) pushed to
`origin/main`.

### Iteration 76 - done (2026-06-09)

**Goal:** Cover updater install progress while the install is still in flight.

**Rationale:** `useAppUpdate` maps Tauri updater progress events into a
user-visible `progress` ratio during the `downloading` state, then forces
progress to `1` when the install completes. The existing hook test only asserted
the final `ready` state, so a regression that stopped surfacing the intermediate
ratio could pass. Holding the mocked install open lets the test assert both
states directly.

**Docs checked:** Context7 `/websites/v2_tauri_app` updater docs for `check()`
and `update.downloadAndInstall()` progress events. The documented JavaScript
flow reports `Started` with `contentLength`, then `Progress` with
`chunkLength`, then `Finished`.

**Claimed files:**
- `src/hooks/useAppUpdate.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily break the hook's progress ratio and run
  `pnpm vitest run src/hooks/useAppUpdate.test.tsx`; the progress assertion
  should fail.
- Focused green test: restore the hook and run
  `pnpm vitest run src/hooks/useAppUpdate.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppUpdate.test.tsx` failed as expected
  after temporarily changing the hook to report `0` for known-length downloads:
  the new assertion expected `0.5` while `downloading`.
- Focused green `pnpm vitest run src/hooks/useAppUpdate.test.tsx` passed: 1 file /
  6 tests.
- `pnpm verify` passed: frontend tests (60 files / 373 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `d44c776` (`test(ui): cover updater progress state`) pushed to
`origin/main`.

### Iteration 77 - done (2026-06-09)

**Goal:** Cover indeterminate updater install progress.

**Rationale:** Tauri updater progress may not know the full download size. The
app intentionally keeps `progress` as `null` during `downloading` when
`contentLength` is absent, so the Settings update card can treat the install as
indeterminate instead of showing a misleading percentage. The known-length test
from iteration 76 did not cover this branch.

**Docs checked:** Context7 official Tauri plugin workspace docs for the updater
plugin flow, plus Context7 `/websites/v2_tauri_app` updater docs. The v2 docs
show `downloadAndInstall()` events and the Rust event model uses
`content_length: Option<u64>`, matching the app's null-aware wrapper.

**Claimed files:**
- `src/hooks/useAppUpdate.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily change unknown-length progress to `0` and run
  `pnpm vitest run src/hooks/useAppUpdate.test.tsx`; the new indeterminate
  assertion should fail.
- Focused green test: restore the hook and run
  `pnpm vitest run src/hooks/useAppUpdate.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppUpdate.test.tsx` failed as expected
  after temporarily reporting `0` for unknown-length progress: the new test
  expected `null`.
- Focused green `pnpm vitest run src/hooks/useAppUpdate.test.tsx` passed: 1 file /
  7 tests.
- `pnpm verify` passed: frontend tests (60 files / 374 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `5bb5911` (`test(ui): cover indeterminate updater progress`) pushed
to `origin/main`.

### Iteration 78 - done (2026-06-09)

**Goal:** Cover updater wrapper indeterminate progress events.

**Rationale:** The hook-level tests from iterations 76-77 mock
`installUpdate`, so they do not prove the wrapper itself preserves
`contentLength: null` from Tauri's progress stream. A wrapper-level test catches
regressions where unknown download size gets coerced to `0` or dropped before it
reaches UI state.

**Docs checked:** Context7 `/websites/v2_tauri_app` updater docs for
`downloadAndInstall()` events. The docs show `Started`, `Progress`, and
`Finished`, and the Tauri v2 Rust event model carries
`content_length: Option<u64>`.

**Claimed files:**
- `src/lib/update.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily coerce missing content length to `0` in
  `src/lib/update.ts` and run `pnpm vitest run src/lib/update.test.ts`; the new
  wrapper assertion should fail.
- Focused green test: restore the wrapper and run
  `pnpm vitest run src/lib/update.test.ts`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/lib/update.test.ts` failed as expected after
  temporarily coercing unknown `contentLength` to `0`; the new test expected
  `null` for all progress events.
- Focused green `pnpm vitest run src/lib/update.test.ts` passed: 1 file /
  7 tests.
- `pnpm verify` passed: frontend tests (60 files / 375 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `2440c0d` (`test(ui): cover updater wrapper progress`) pushed to
`origin/main`.

### Iteration 79 - done (2026-06-09)

**Goal:** Extract the duplicated minute tick into a shared hook.

**Rationale:** `MissionControl` and `ProjectPanel` both owned the same
`Date.now()` state, one-minute interval, and cleanup effect so elapsed agent
times keep advancing. A small `useMinuteNow` hook keeps that lifecycle in one
place and removes duplicate effect code from both components.

**Docs checked:** Context7 `/reactjs/react.dev` docs for `useEffect` interval
cleanup. The current docs show setting up `setInterval` inside an effect and
returning `clearInterval(id)` from cleanup.

**Claimed files:**
- `src/hooks/useMinuteNow.ts`
- `src/hooks/useMinuteNow.test.tsx`
- `src/components/MissionControl.tsx`
- `src/components/ProjectPanel.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: `pnpm vitest run src/hooks/useMinuteNow.test.tsx` should fail before
  the hook exists.
- Focused green tests:
  `pnpm vitest run src/hooks/useMinuteNow.test.tsx src/lib/agentState.test.ts src/lib/sidebarAgents.test.ts`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useMinuteNow.test.tsx` failed before the
  hook existed with an unresolved import for `./useMinuteNow`.
- First focused run caught a test bug: `vi.setSystemTime()` followed by
  `vi.advanceTimersByTime(60_000)` advanced the fake clock to `00:02`, not
  `00:01`; the test now relies on timer advancement from the initial clock.
- Focused green
  `pnpm vitest run src/hooks/useMinuteNow.test.tsx src/lib/agentState.test.ts src/lib/sidebarAgents.test.ts`
  passed: 3 files / 14 tests.
- Initial full `pnpm verify` caught a real refactor miss:
  `ProjectPanel` still used `useState` in `WorkspaceInfo` after the interval
  state moved out; restored the `useState` import.
- Targeted rerun
  `pnpm vitest run src/hooks/useMinuteNow.test.tsx src/lib/agentState.test.ts src/lib/sidebarAgents.test.ts src/App.test.tsx`
  passed: 4 files / 63 tests.
- `pnpm verify` passed: frontend tests (61 files / 377 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `2dd230c` (`refactor(ui): share minute tick hook`) pushed to
`origin/main`.

### Iteration 80 - done (2026-06-09)

**Goal:** Cover pointer-cancel drag cleanup.

**Rationale:** `useTaskCardPointerDrag` already has a dedicated
`pointercancel` branch, but tests covered pointerup, unmount, and busy-flip
cleanup only. Browser cancellation should end the drag, remove the ghost, unlock
page selection, and avoid treating the cancelled gesture as a drop.

**Docs checked:** MDN `pointercancel` event reference. It documents
`pointercancel` as the browser signal that no more pointer events are likely,
including when panning, zooming, scrolling, hardware changes, or other
interruptions cancel pointer activity.

**Claimed files:**
- `src/hooks/useTaskCardPointerDrag.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily remove the `onDragEnd()` call from the hook's
  `pointercancel` branch and run
  `pnpm vitest run src/hooks/useTaskCardPointerDrag.test.tsx`; the new cancel
  test should fail.
- Focused green test: restore the hook and run
  `pnpm vitest run src/hooks/useTaskCardPointerDrag.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useTaskCardPointerDrag.test.tsx` failed
  as expected after temporarily removing `onDragEnd()` from the
  `pointercancel` branch; the new test observed 0 cancel callbacks.
- Focused green `pnpm vitest run src/hooks/useTaskCardPointerDrag.test.tsx`
  passed: 1 file / 7 tests.
- `pnpm verify` passed: frontend tests (61 files / 378 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `b1a6cc7` (`test(ui): cover pointer cancel drag cleanup`) pushed to
`origin/main`.

### Iteration 81 - done (2026-06-09)

**Goal:** Cover command palette global shortcut behavior.

**Rationale:** `CommandPalette` owns a global Cmd/Ctrl-K key listener, but there
was no direct component test that it opens, closes, ignores unrelated keys, and
prevents the browser default for the app shortcut. The test keeps the shell's
keyboard entry point explicit.

**Docs checked:** Context7 `/shadcn-ui/ui` command docs. The current
`CommandDialog` examples use a global `keydown` listener for command-palette
shortcuts and call `preventDefault()` before toggling the dialog.

**Claimed files:**
- `src/components/CommandPalette.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily remove `event.preventDefault()` from
  `CommandPalette` and run `pnpm vitest run src/components/CommandPalette.test.tsx`;
  the shortcut tests should fail on default prevention.
- Focused green test: restore the component and run
  `pnpm vitest run src/components/CommandPalette.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/components/CommandPalette.test.tsx` failed as
  expected after temporarily removing `event.preventDefault()`; the open and
  close shortcut tests observed `defaultPrevented === false`.
- Focused green `pnpm vitest run src/components/CommandPalette.test.tsx`
  passed: 1 file / 3 tests.
- `pnpm verify` passed: frontend tests (62 files / 381 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `e2583bb` (`test(ui): cover command palette shortcut`) pushed to
`origin/main`.

### Iteration 82 - done (2026-06-09)

**Goal:** Cover command palette item selection ordering.

**Rationale:** `CommandPalette` intentionally closes the dialog before running a
selected command so the routed view does not render behind a closing overlay.
The shortcut tests from iteration 81 cover opening/closing via keyboard; this
iteration locks down the separate `CommandItem` selection path and call order.

**Docs checked:** Context7 `/shadcn-ui/ui` command docs for `CommandItem`
selection usage. The docs show command items using `onSelect` to run command
actions inside command lists/dialogs.

**Claimed files:**
- `src/components/CommandPalette.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: temporarily remove `onOpenChange(false)` from the `run` helper and
  run `pnpm vitest run src/components/CommandPalette.test.tsx`; the new
  selection-order test should fail.
- Focused green test: restore the helper and run
  `pnpm vitest run src/components/CommandPalette.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/components/CommandPalette.test.tsx` failed as
  expected after temporarily removing `onOpenChange(false)` from the selection
  helper; the new selection-order test observed no close call.
- Focused green `pnpm vitest run src/components/CommandPalette.test.tsx`
  passed: 1 file / 4 tests.
- `pnpm verify` passed: frontend tests (62 files / 382 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `3527f7f` (`test(ui): cover command palette selection`) pushed to
`origin/main`.

### Iteration 83 - done (2026-06-09)

**Goal:** Cover shell bootstrap default selection and stale workspace cleanup.

**Rationale:** `useShellBootstrap` is mounted once at the app root and silently
chooses the initial agent/repo selections while clearing a focused workspace that
was deleted elsewhere. Those rules are central to the shell's startup behavior
but currently have no direct hook tests.

**Docs checked:** Context7 `/tanstack/query` React testing docs. The current
guidance is to test Query-backed hooks with a `QueryClientProvider` wrapper and
an isolated `QueryClient`; retries should be disabled for deterministic tests,
which matches the repo's `createQueryClient` factory.

**Claimed files:**
- `src/hooks/useShellBootstrap.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused test: `pnpm vitest run src/hooks/useShellBootstrap.test.tsx`.
- Red check: temporarily break one bootstrap effect and rerun the focused test
  to confirm the new assertions fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/hooks/useShellBootstrap.test.tsx` passed:
  1 file / 4 tests.
- Red check `pnpm vitest run src/hooks/useShellBootstrap.test.tsx` failed as
  expected after temporarily disabling the default-agent assignment in
  `useShellBootstrap`; the default and fallback agent tests observed
  `selectedAgentProfileId === undefined`.
- Restored focused green `pnpm vitest run src/hooks/useShellBootstrap.test.tsx`
  passed: 1 file / 4 tests.
- `pnpm verify` passed: frontend tests (63 files / 386 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `cfb3de3` (`test(ui): cover shell bootstrap defaults`) pushed to
`origin/main`.

### Iteration 84 - done (2026-06-09)

**Goal:** Centralize agent-profile default resolution.

**Rationale:** The shell, composer, JIRA launch panel, task review action, and
PR Reviews page all spell their own `preferred ?? first profile` fallback. That
duplicates behavior and lets stale IDs from settings or local state select a
profile that is no longer available. A small shared helper can validate
preferred IDs once and make reviewer fallback behavior explicit.

**Docs checked:** Context7 `/reactjs/react.dev` state docs. The current guidance
allows local state to be initialized from props and conditionally synchronized
when props/options load, as long as updates avoid clobbering user edits; the PR
Reviews page already follows that pattern and should keep seeding only when the
selection is empty.

**Claimed files:**
- `src/lib/agentProfiles.ts`
- `src/lib/agentProfiles.test.ts`
- `src/hooks/useShellBootstrap.ts`
- `src/hooks/useShellBootstrap.test.tsx`
- `src/AppRouter.tsx`
- `src/components/ReviewsPage.tsx`
- `src/components/ReviewsPage.test.tsx`
- `src/components/JiraWorkItemDialog.tsx`
- `src/components/TaskWorkspace.tsx`
- `docs/features.md`
- `AGENTS.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add helper and stale-default tests before the helper/refactor and
  run `pnpm vitest run src/lib/agentProfiles.test.ts src/hooks/useShellBootstrap.test.tsx`.
- Focused green tests after implementation:
  `pnpm vitest run src/lib/agentProfiles.test.ts src/hooks/useShellBootstrap.test.tsx src/components/ReviewsPage.test.tsx src/components/JiraWorkItemDialog.test.tsx src/components/TaskWorkspace.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check
  `pnpm vitest run src/lib/agentProfiles.test.ts src/hooks/useShellBootstrap.test.tsx`
  failed as expected before implementation: `src/lib/agentProfiles.test.ts`
  could not resolve the missing helper module, and the stale-default bootstrap
  test observed `selectedAgentProfileId === 99`.
- Focused green
  `pnpm vitest run src/lib/agentProfiles.test.ts src/hooks/useShellBootstrap.test.tsx src/components/ReviewsPage.test.tsx src/components/JiraWorkItemDialog.test.tsx src/components/TaskWorkspace.test.tsx`
  passed: 5 files / 43 tests.
- `pnpm verify` passed: frontend tests (64 files / 391 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `ba0d071` (`refactor(ui): centralize agent profile defaults`) pushed
to `origin/main`.

### Iteration 85 - done (2026-06-09)

**Goal:** Use available agent-profile resolution for session starts.

**Rationale:** After centralizing default profile resolution, `useSessionCommands`
still had the old `task.agentProfileId ?? selectedAgentProfileId ??
agentProfiles[0]?.id` chain. That can pass a deleted/stale task profile id to the
backend instead of falling back to the selected or first available profile.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. The current
guidance for custom hooks is to wrap returned functions in `useCallback` and
declare every reactive value used inside the callback; this change should keep
the returned session command functions dependency-complete.

**Claimed files:**
- `src/hooks/useSessionCommands.ts`
- `src/hooks/useSessionCommands.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a stale saved-profile test and run
  `pnpm vitest run src/hooks/useSessionCommands.test.tsx`; it should fail before
  the hook uses `resolveAgentProfileId`.
- Focused green: rerun `pnpm vitest run src/hooks/useSessionCommands.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useSessionCommands.test.tsx` failed as
  expected before implementation; the new stale saved-profile test saw
  `api.startSession(9, 99)` instead of the selected available profile id `2`.
- Focused green `pnpm vitest run src/hooks/useSessionCommands.test.tsx` passed:
  1 file / 5 tests.
- `pnpm verify` passed: frontend tests (64 files / 392 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `62acdd9` (`fix(ui): ignore stale session agent profiles`) pushed to
`origin/main`.

### Iteration 86 - done (2026-06-09)

**Goal:** Stabilize session attention wrapper callbacks.

**Rationale:** `useSessionAttentionControls` wraps the lower-level session
commands to clear task attention before start/resume/stop, but three returned
wrappers were recreated on every render. Those functions flow into the task
workspace tree, so they should follow the same stable custom-hook callback
contract as `useSessionCommands`.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. React
recommends wrapping functions returned from custom hooks in `useCallback`; the
callback identity is reused while dependencies are `Object.is`-equal.

**Claimed files:**
- `src/hooks/useSessionAttentionControls.ts`
- `src/hooks/useSessionAttentionControls.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a callback-stability test and run
  `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx`; it should
  fail while start/resume/stop are plain functions.
- Focused green: rerun
  `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx`
  failed as expected before implementation; the callback-stability test saw a
  new `startSession` function identity after rerender.
- Focused green `pnpm vitest run src/hooks/useSessionAttentionControls.test.tsx`
  passed: 1 file / 6 tests.
- `pnpm verify` passed: frontend tests (64 files / 393 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `837d598` (`refactor(ui): stabilize session attention callbacks`)
pushed to `origin/main`.

### Iteration 87 - done (2026-06-09)

**Goal:** Cover task metadata cache updates and attention clearing.

**Rationale:** `useTaskActions` is the central task metadata hook for board and
workspace surfaces. Its `updateStatus` path replaces the task in the TanStack
Query cache and clears attention when a task is marked `done`, but this behavior
only had broad UI coverage.

**Docs checked:** Context7 `/tanstack/query` testing docs. The current guidance
is to mount Query-backed hook tests with a `QueryClientProvider` and an isolated
`QueryClient` per test, matching the repo's existing `createQueryClient` helper.

**Claimed files:**
- `src/hooks/useTaskActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green: `pnpm vitest run src/hooks/useTaskActions.test.tsx`.
- Red check: temporarily remove the `status === "done"` attention-clear branch
  and rerun the focused test; the new test should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/hooks/useTaskActions.test.tsx` passed:
  1 file / 1 test.
- Red check failed as expected after temporarily removing the `status === "done"`
  attention-clear branch; the task attention array still contained task `7`.
- Restored focused green `pnpm vitest run src/hooks/useTaskActions.test.tsx`
  passed: 1 file / 1 test.
- `pnpm verify` passed: frontend tests (65 files / 394 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `a07086b` (`test(ui): cover task status attention cleanup`) pushed to
`origin/main`.

### Iteration 88 - done (2026-06-09)

**Goal:** Cover the remaining task metadata action cache contracts.

**Rationale:** After the status/attention path, `useTaskActions` still had two
user-visible metadata actions without focused coverage: title renames and JIRA
link attach/detach. Both update the central tasks TanStack Query cache that
Mission Control, boards, and task workspaces read.

**Docs checked:** Context7 `/vitest-dev/vitest/v4.1.6` mock-function docs. The
current Vitest guidance supports hoisted `vi.mock` module mocks, typed access via
`vi.mocked`, and per-test mock-state cleanup before assertions.

**Claimed files:**
- `src/hooks/useTaskActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green: `pnpm vitest run src/hooks/useTaskActions.test.tsx`.
- Red check: temporarily remove the title `trim()` behavior and rerun the
  focused test; the rename test should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/hooks/useTaskActions.test.tsx` passed:
  1 file / 4 tests.
- Red check failed as expected after temporarily removing the title `trim()`;
  the rename test saw the untrimmed API payload and the blank-title guard test
  saw an unwanted API call.
- Restored focused green `pnpm vitest run src/hooks/useTaskActions.test.tsx`
  passed: 1 file / 4 tests.
- `pnpm verify` passed: frontend tests (65 files / 397 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `f6fcf38` (`test(ui): cover task metadata actions`) pushed to
`origin/main`.

### Iteration 89 - done (2026-06-09)

**Goal:** Cover settings action cache updates and bootstrap invalidation.

**Rationale:** `useSettingsActions` owns two high-leverage writes: app settings
and agent-profile saves. The app-settings path writes the settings cache, updates
the selected default agent, then invalidates all bootstrap reads; the profile path
upserts the saved profile into the profile cache. Both are central to the
settings screen and shell bootstrap behavior.

**Docs checked:** Context7 `/tanstack/query` mutation/cache docs. Current
guidance is to write mutation responses with `queryClient.setQueryData` and
invalidate related queries after mutation success, returning/awaiting the
invalidation work when subsequent code depends on refreshed state.

**Claimed files:**
- `src/hooks/useSettingsActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green: `pnpm vitest run src/hooks/useSettingsActions.test.tsx`.
- Red check: temporarily remove the app-settings `refresh()` call and rerun the
  focused test; the bootstrap invalidation assertions should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/hooks/useSettingsActions.test.tsx` passed:
  1 file / 2 tests.
- Red check failed as expected after temporarily removing the app-settings
  `refresh()` call; the bootstrap invalidation assertion saw
  `isInvalidated === false`.
- Restored focused green `pnpm vitest run src/hooks/useSettingsActions.test.tsx`
  passed: 1 file / 2 tests.
- The first full gate caught a TypeScript fixture issue (`id` specified twice in
  the test helper); destructuring `id` out of the helper overrides fixed it.
- `pnpm verify` passed after the fixture fix: frontend tests (66 files /
  399 tests), frontend build, Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `42d4e1e` (`test(ui): cover settings action cache updates`) pushed
to `origin/main`.

### Iteration 90 - done (2026-06-09)

**Goal:** Cover workspace action focus and refresh contracts.

**Rationale:** The workspace manager has UI coverage for create/update form
flows, but `useWorkspaceActions` owns the hook-level state contract: create
focuses the returned workspace, update/delete refresh bootstrap data, and delete
only clears `activeWorkspaceId` when the deleted workspace is currently focused.

**Docs checked:** Context7 `/tanstack/query` invalidation docs. Current guidance
is to invalidate related queries on mutation success and await the invalidation
work when the mutation flow depends on the cache being marked stale.

**Claimed files:**
- `src/hooks/useWorkspaceActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green: `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx`.
- Red check: temporarily remove the active-workspace clear in `deleteWorkspace`
  and rerun the focused test; the delete-focus assertion should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Initial focused run exposed a test-seed issue: `setQueryData(..., undefined)`
  did not create a settings query state, so the invalidation helper saw no
  settings query. Fixed by seeding a concrete settings fixture.
- Focused green `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx`
  passed: 1 file / 3 tests.
- Red check failed as expected after temporarily removing the active-workspace
  clear in `deleteWorkspace`; `activeWorkspaceId` remained `5`.
- Restored focused green `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx`
  passed: 1 file / 3 tests.
- `pnpm verify` passed: frontend tests (67 files / 402 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `ab6ed35` (`test(ui): cover workspace action focus`) pushed to
`origin/main`.

### Iteration 91 - done (2026-06-09)

**Goal:** Cover project-add cancellation and selection behavior.

**Rationale:** `useProjectActions` is the remaining small action hook with
user-visible behavior: canceling the folder picker must stop before `addRepo`,
while a selected folder should add the repo, select the returned repo before the
refresh lands, invalidate bootstrap reads, and show the success message.

**Docs checked:** Context7 `/vitest-dev/vitest/v4.1.6` mock-function docs.
Current guidance covers hoisted module mocks, `mockResolvedValue` for async
functions, and call assertions such as `toHaveBeenCalledWith`.

**Claimed files:**
- `src/hooks/useProjectActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green: `pnpm vitest run src/hooks/useProjectActions.test.tsx`.
- Red check: temporarily remove the folder-selection cancellation return and
  rerun the focused test; the cancel test should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green `pnpm vitest run src/hooks/useProjectActions.test.tsx` passed:
  1 file / 2 tests.
- Red check failed as expected after temporarily removing the folder-selection
  cancellation return; `addRepo` was called with `null`.
- Restored focused green `pnpm vitest run src/hooks/useProjectActions.test.tsx`
  passed: 1 file / 2 tests.
- `pnpm verify` passed: frontend tests (68 files / 404 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `148d6e9` (`test(ui): cover project add action`) pushed to
`origin/main`.

### Iteration 92 - done (2026-06-09)

**Goal:** Centralize repeated bootstrap-query test helpers.

**Rationale:** The recent project/workspace/settings action tests duplicated the
same app-settings fixture, bootstrap query seeding, and invalidation assertions.
Moving those into `src/test/testUtils.tsx` keeps the test contract in one place
and avoids future drift around TanStack Query's "seed concrete query data before
asserting invalidation" behavior.

**Docs checked:** Context7 `/tanstack/query` `queryClient.invalidateQueries`
reference. Current docs state that invalidation marks matching cached queries
invalid and refetches active ones by default, which matches the shared
`getQueryState(...).isInvalidated` helper.

**Claimed files:**
- `src/test/testUtils.tsx`
- `src/hooks/useProjectActions.test.tsx`
- `src/hooks/useWorkspaceActions.test.tsx`
- `src/hooks/useSettingsActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Focused green:
  `pnpm vitest run src/hooks/useProjectActions.test.tsx src/hooks/useWorkspaceActions.test.tsx src/hooks/useSettingsActions.test.tsx`.
- Red check: temporarily flip the shared invalidation helper to expect `false`
  and rerun the focused tests; invalidation tests should fail.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Focused green
  `pnpm vitest run src/hooks/useProjectActions.test.tsx src/hooks/useWorkspaceActions.test.tsx src/hooks/useSettingsActions.test.tsx`
  passed: 3 files / 7 tests.
- Red check failed as expected after temporarily flipping the shared
  `expectQueryInvalidated` helper to expect `false`; all invalidation-dependent
  tests saw `isInvalidated === true`.
- Restored focused green passed again: 3 files / 7 tests.
- `pnpm verify` passed: frontend tests (68 files / 404 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `df27b98` (`test(ui): share bootstrap query helpers`) pushed to
`origin/main`.

### Iteration 93 - done (2026-06-09)

**Goal:** Stabilize the JIRA board config action callback.

**Rationale:** `useJiraBoardView` returns several action callbacks into the JIRA
board tree. Most are already wrapped in `useCallback`, but `setBoardConfig` is
recreated on every render despite stable inputs. React's custom-hook guidance
recommends wrapping returned functions in `useCallback` so consumers can optimize
or avoid unnecessary effects.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. Current
guidance explicitly recommends wrapping functions returned from custom hooks.

**Claimed files:**
- `src/hooks/useJiraBoardView.ts`
- `src/hooks/useJiraBoardView.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add the callback-stability test and run
  `pnpm vitest run src/hooks/useJiraBoardView.test.tsx`; it should fail while
  `setBoardConfig` is an inline function.
- Focused green: rerun
  `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` after wrapping it in
  `useCallback`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` failed as
  expected before implementation; `setBoardConfig` had a new function identity
  after rerender.
- Focused green `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` passed:
  1 file / 1 test.
- `pnpm verify` passed: frontend tests (69 files / 405 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `bb8d91d` (`refactor(ui): stabilize jira board config action`)
pushed to `origin/main`.

### Iteration 94 - done (2026-06-09)

**Goal:** Stabilize the project-add action callback returned by
`useProjectActions`.

**Rationale:** `useProjectActions` exposes `addProject` to shell/UI consumers but
currently recreates the function on every render. React's custom-hook guidance
recommends wrapping returned functions in `useCallback`, which keeps the hook API
friendlier to memoized consumers and effects without changing behavior.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. Current
guidance recommends wrapping functions returned from custom hooks and using a
complete dependency array so the cached function is reused until dependencies
change.

**Claimed files:**
- `src/hooks/useProjectActions.ts`
- `src/hooks/useProjectActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a callback-stability test and run
  `pnpm vitest run src/hooks/useProjectActions.test.tsx`; it should fail while
  `addProject` is an inline function.
- Focused green: rerun
  `pnpm vitest run src/hooks/useProjectActions.test.tsx` after wrapping
  `addProject` in `useCallback`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useProjectActions.test.tsx` failed as
  expected before implementation; `addProject` had a new function identity after
  rerender.
- Focused green `pnpm vitest run src/hooks/useProjectActions.test.tsx` passed:
  1 file / 3 tests.
- `pnpm verify` passed: frontend tests (69 files / 406 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `b526c2b` (`refactor(ui): stabilize project add callback`) pushed
to `origin/main`.

### Iteration 95 - done (2026-06-09)

**Goal:** Stabilize the workspace action callbacks returned by
`useWorkspaceActions`.

**Rationale:** `useWorkspaceActions` exposes `createWorkspace`,
`updateWorkspace`, and `deleteWorkspace` to workspace management UI. They are
currently recreated on every render despite stable inputs. React's custom-hook
guidance recommends wrapping returned functions in `useCallback`, keeping the
hook API consistent with the recently stabilized project and JIRA actions.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. Current
guidance recommends wrapping functions returned from custom hooks and supplying
the dependency array so React can reuse the callback while dependencies are
unchanged.

**Claimed files:**
- `src/hooks/useWorkspaceActions.ts`
- `src/hooks/useWorkspaceActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a callback-stability test and run
  `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx`; it should fail
  while the workspace actions are inline functions.
- Focused green: rerun
  `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx` after wrapping the
  returned actions in `useCallback`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx` failed as
  expected before implementation; `createWorkspace` had a new function identity
  after rerender.
- Focused green `pnpm vitest run src/hooks/useWorkspaceActions.test.tsx` passed:
  1 file / 4 tests.
- `pnpm verify` passed: frontend tests (69 files / 407 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `2137d8d` (`refactor(ui): stabilize workspace action callbacks`)
pushed to `origin/main`.

### Iteration 96 - done (2026-06-09)

**Goal:** Stabilize the settings action callbacks returned by
`useSettingsActions`.

**Rationale:** `useSettingsActions` exposes `saveAppSettings` and
`saveAgentProfile` as hook API actions, but both are recreated on every render.
React's custom-hook guidance recommends wrapping returned functions in
`useCallback`; doing the same here makes the settings action API consistent with
the project, workspace, and JIRA action hooks.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. Current
guidance recommends wrapping functions returned from custom hooks and supplying
dependencies so the callbacks are reused while those dependencies are unchanged.

**Claimed files:**
- `src/hooks/useSettingsActions.ts`
- `src/hooks/useSettingsActions.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a callback-stability test and run
  `pnpm vitest run src/hooks/useSettingsActions.test.tsx`; it should fail while
  the settings actions are inline functions.
- Focused green: rerun
  `pnpm vitest run src/hooks/useSettingsActions.test.tsx` after wrapping the
  returned actions in `useCallback`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useSettingsActions.test.tsx` failed as
  expected before implementation; `saveAppSettings` had a new function identity
  after rerender.
- Focused green `pnpm vitest run src/hooks/useSettingsActions.test.tsx` passed:
  1 file / 3 tests.
- `pnpm verify` passed: frontend tests (69 files / 408 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `dabe121` (`refactor(ui): stabilize settings action callbacks`)
pushed to `origin/main`.

### Iteration 97 - done (2026-06-09)

**Goal:** Narrow `useJiraBoardView` callback dependencies to stable JIRA action
functions.

**Rationale:** `useJiraBoardView` already wraps its board actions in
`useCallback`, but `saveToken`, `disconnect`, and `createWorkItem` depend on the
whole `jira` return object. `useJira` returns a fresh object each render, so those
callbacks are recreated even when the underlying action functions are stable.
Depending on the specific function fields preserves behavior while avoiding
unnecessary callback churn.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` / `useMemo` docs.
Current guidance shows caching functions with the specific dependencies they use,
and memoizing object values when object identity itself is part of the contract.

**Claimed files:**
- `src/hooks/useJiraBoardView.ts`
- `src/hooks/useJiraBoardView.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a test where `useJira` returns a fresh wrapper object with
  stable action functions and run
  `pnpm vitest run src/hooks/useJiraBoardView.test.tsx`; it should fail while
  callbacks depend on the whole object.
- Focused green: rerun
  `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` after depending on the
  specific JIRA action functions.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` failed as
  expected before implementation; `saveToken` changed identity when `useJira`
  returned a fresh wrapper object.
- Focused green `pnpm vitest run src/hooks/useJiraBoardView.test.tsx` passed:
  1 file / 2 tests.
- `pnpm verify` passed: frontend tests (69 files / 409 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `8ecfc7d` (`refactor(ui): narrow jira board action dependencies`)
pushed to `origin/main`.

### Iteration 98 - done (2026-06-09)

**Goal:** Memoize JIRA board columns derived by `useJira`.

**Rationale:** `deriveColumns(items, projectStatuses, statusFilter)` is pure
derived data, but `useJira` currently calls it on every render and returns a new
`columns` array even when the underlying query data and filter are unchanged.
Memoizing the derived array keeps board consumers from receiving unnecessary
reference churn.

**Docs checked:** Context7 `/reactjs/react.dev` `useMemo` docs. Current guidance
shows using `useMemo` for derived arrays/objects so memoized children or effects
only see a new reference when the dependencies change.

**Claimed files:**
- `src/hooks/useJira.ts`
- `src/hooks/useJira.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a columns-reference stability test and run
  `pnpm vitest run src/hooks/useJira.test.ts`; it should fail while
  `deriveColumns` runs directly during every render.
- Focused green: rerun `pnpm vitest run src/hooks/useJira.test.ts` after
  memoizing the derived columns.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJira.test.ts` failed as expected
  before implementation; `columns` was deeply equal but a new array reference
  after rerender.
- Focused green `pnpm vitest run src/hooks/useJira.test.ts` passed:
  1 file / 5 tests.
- `pnpm verify` passed: frontend tests (69 files / 410 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `289d8c0` (`perf(ui): memoize jira board columns`) pushed to
`origin/main`.

### Iteration 99 - done (2026-06-09)

**Goal:** Cancel in-flight JIRA board queries before optimistic transitions.

**Rationale:** `useJira.transition` snapshots the board, writes an optimistic
status change, and rolls back on error. TanStack Query's optimistic-update guide
recommends cancelling matching outgoing refetches before `setQueryData` so a
stale response cannot overwrite the optimistic update while the mutation is in
flight.

**Docs checked:** Context7 `/tanstack/query` optimistic updates and
`queryClient.cancelQueries` docs. Current guidance explicitly cancels matching
queries before snapshotting and writing optimistic cache state.

**Claimed files:**
- `src/hooks/useJira.ts`
- `src/hooks/useJira.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a focused test that transition calls
  `queryClient.cancelQueries({ queryKey: queryKeys.jira.board() })` before the
  optimistic path and run `pnpm vitest run src/hooks/useJira.test.ts`; it should
  fail before implementation.
- Focused green: rerun `pnpm vitest run src/hooks/useJira.test.ts` after adding
  the cancellation.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJira.test.ts` failed as expected
  before implementation; `queryClient.cancelQueries` had zero calls during
  transition.
- Focused green `pnpm vitest run src/hooks/useJira.test.ts` passed:
  1 file / 6 tests.
- `pnpm verify` passed: frontend tests (69 files / 411 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `03856f2` (`fix(ui): guard jira optimistic transitions`) pushed to
`origin/main`.

### Iteration 100 - done (2026-06-09)

**Goal:** Roll back failed JIRA optimistic transitions when no board snapshot
existed.

**Rationale:** After the cancellation improvement, the optimistic transition path
still only restores the board cache when `previous` is truthy. If transition is
called before any board data exists and the mutation fails, the optimistic
`setQueryData` creates an empty board cache entry that is not rolled back.
TanStack Query's rollback guidance treats the snapshotted previous value as the
state to restore, including the "no previous data" edge case.

**Docs checked:** Context7 `/tanstack/query` optimistic update rollback docs.
Current guidance snapshots previous query data before the optimistic write and
uses that snapshot in the error path to restore cache state.

**Claimed files:**
- `src/hooks/useJira.ts`
- `src/hooks/useJira.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a focused test that calls `transition` with no cached board data
  and a rejected mutation, then assert the board query cache is removed; run
  `pnpm vitest run src/hooks/useJira.test.ts` and expect failure before
  implementation.
- Focused green: rerun `pnpm vitest run src/hooks/useJira.test.ts` after
  removing the optimistic cache entry when no previous snapshot existed.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJira.test.ts` failed as expected
  before implementation; the failed no-snapshot transition left `[]` in the
  board cache instead of `undefined`.
- Focused green `pnpm vitest run src/hooks/useJira.test.ts` passed:
  1 file / 7 tests.
- `pnpm verify` passed: frontend tests (69 files / 412 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `bb7ff16` (`fix(ui): roll back empty jira optimistic cache`) pushed
to `origin/main`.

### Iteration 101 - in progress (2026-06-09)

**Goal:** Ignore cached JIRA project-status skeletons while REST is disconnected.

**Rationale:** TanStack Query returns cached data for a disabled query. `useJira`
disables the project-status query when the optional REST token is disconnected,
but still reads `.data`, so a previously cached status skeleton can keep
rendering empty REST-only columns after disconnect. The board should derive
columns from visible items only unless REST is currently connected.

**Docs checked:** Context7 `/tanstack/query` disabled-query docs. Current
guidance states that disabled queries initialize in success state when cached
data exists, even though they do not fetch.

**Claimed files:**
- `src/hooks/useJira.ts`
- `src/hooks/useJira.test.ts`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: seed cached project statuses while `jiraRestStatus` is disconnected
  and run `pnpm vitest run src/hooks/useJira.test.ts`; it should fail while the
  disabled query data is still consumed.
- Focused green: rerun `pnpm vitest run src/hooks/useJira.test.ts` after gating
  project status data on `restConnected`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useJira.test.ts` failed as expected
  before implementation; cached project statuses were still exposed while
  `restConnected` was false.
- Focused green `pnpm vitest run src/hooks/useJira.test.ts` passed:
  1 file / 8 tests.
- `pnpm verify` passed: frontend tests (69 files / 413 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `9fac1e1` (`fix(ui): ignore stale jira statuses when disconnected`)
pushed to `origin/main`.

### Iteration 102 - in progress (2026-06-09)

**Goal:** Hide cached GitHub pull-request status when the selected task no
longer has a PR URL.

**Rationale:** TanStack Query returns cached data for a disabled query.
`useGithubPullRequestQuery` disables the PR-status read when the selected task
has no `prUrl`, but `useGithub` still reads `.data`, so a cached PR status for
the same task id can keep rendering after the link is removed or absent. The UI
should treat "no PR URL" as authoritative and expose no pull request.

**Docs checked:** Context7 `/tanstack/query` disabled-query docs. Current
guidance states that disabled queries initialize in success state when cached
data exists, even though they do not fetch.

**Claimed files:**
- `src/hooks/useGithub.ts`
- `src/hooks/useGithub.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: seed cached PR-status data for a task whose `prUrl` is now `null`
  and run `pnpm vitest run src/hooks/useGithub.test.tsx`; it should fail while
  the disabled query data is still consumed.
- Focused green: rerun `pnpm vitest run src/hooks/useGithub.test.tsx` after
  gating PR-status data on the selected task's active PR prerequisite.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useGithub.test.tsx` failed as expected
  before implementation; cached PR status was exposed even though the selected
  task had `prUrl: null`.
- Focused green `pnpm vitest run src/hooks/useGithub.test.tsx` passed:
  1 file / 1 test.
- `pnpm verify` passed: frontend tests (70 files / 414 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `c226b73` (`fix(ui): hide stale github pr status`) pushed to
`origin/main`.

### Iteration 103 - in progress (2026-06-09)

**Goal:** Hide cached task-diff summaries when no task is selected.

**Rationale:** `useTaskDiff` documents that switching to no task should show a
`null` summary immediately, but the disabled `skipToken` query still exposes
cached data if the `["task", "diff-summary", undefined]` cache cell is ever
seeded. The hook should treat `taskId == null` as authoritative for `summary`,
`loading`, and `error`, matching the selected-task boundary.

**Docs checked:** Context7 `/tanstack/query` disabled-query docs. Current
guidance states that disabled queries initialize in success state when cached
data exists, even though they do not fetch.

**Claimed files:**
- `src/hooks/useTaskDiff.ts`
- `src/hooks/useTaskDiff.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: seed cached diff-summary data for the undefined task key and run
  `pnpm vitest run src/hooks/useTaskDiff.test.tsx`; it should fail while the
  disabled query data is still consumed.
- Focused green: rerun `pnpm vitest run src/hooks/useTaskDiff.test.tsx` after
  gating returned diff state on `taskId != null`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useTaskDiff.test.tsx` failed as
  expected before implementation; cached diff-summary data for the undefined
  task key was exposed while no task was selected.
- Focused green `pnpm vitest run src/hooks/useTaskDiff.test.tsx` passed:
  1 file / 8 tests.
- `pnpm verify` passed: frontend tests (70 files / 415 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `e05952d` (`fix(ui): hide stale task diff summary`) pushed to
`origin/main`.

### Iteration 104 - in progress (2026-06-09)

**Goal:** Ignore cached GitHub PR-detection results when the selected task is
not eligible for detection.

**Rationale:** `useGithubPullRequestDetectionQuery` disables branch PR
detection unless GitHub is connected, the selected task has a worktree, and the
task has no linked `prUrl`. `useGithub` still reads `.data` directly and uses it
in an effect, so a cached detection result can backfill a PR URL for a task that
is no longer detection-eligible. The effect should share the query's eligibility
gate.

**Docs checked:** Context7 `/tanstack/query` disabled-query docs. Current
guidance states that disabled queries initialize in success state when cached
data exists, even though they do not fetch.

**Claimed files:**
- `src/hooks/useGithub.ts`
- `src/hooks/useGithub.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: seed cached PR-detection data for a task that has no worktree and
  run `pnpm vitest run src/hooks/useGithub.test.tsx`; it should fail while the
  effect still backfills from disabled-query cache data.
- Focused green: rerun `pnpm vitest run src/hooks/useGithub.test.tsx` after
  gating the detection effect on the same prerequisites as the query.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useGithub.test.tsx` failed as expected
  before implementation; cached detection data called `applyTask` even though
  the selected task had no worktree.
- Focused green `pnpm vitest run src/hooks/useGithub.test.tsx` passed:
  1 file / 2 tests.
- `pnpm verify` passed: frontend tests (70 files / 416 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `9db7bb3` (`fix(ui): gate github pr detection cache`) pushed to
`origin/main`.

### Iteration 105 - in progress (2026-06-09)

**Goal:** Replay live terminal output buffered during a failed history snapshot.

**Rationale:** `TerminalPane` buffers `session_output` events while
`sessionOutputSnapshot` is loading, then replays them after the history snapshot.
If the snapshot request rejects, the catch path writes an error line but never
flushes `pendingOutput`, so fresh live output emitted during the failed snapshot
can be hidden until another chunk arrives. The failure path should still drain
pending live output and sync the PTY size.

**Docs checked:** Context7 `/xtermjs/xterm.js` docs. Current API docs show
`Terminal.write(data)` as the standard way to feed PTY output and document
reconnection/state-restoration patterns.

**Claimed files:**
- `src/TerminalPane.tsx`
- `src/TerminalPane.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: make `sessionOutputSnapshot` reject after a live `session_output`
  chunk has been buffered and run `pnpm vitest run src/TerminalPane.test.tsx`;
  it should fail while the pending live output remains unwritten.
- Focused green: rerun `pnpm vitest run src/TerminalPane.test.tsx` after
  flushing pending output in the snapshot failure path.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/TerminalPane.test.tsx` failed as expected
  before implementation; live output buffered during a failed snapshot was never
  written to xterm.
- Focused green `pnpm vitest run src/TerminalPane.test.tsx` passed:
  1 file / 12 tests.
- `pnpm verify` passed: frontend tests (70 files / 417 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `1153e4f` (`fix(ui): flush terminal output after snapshot failure`)
pushed to `origin/main`.

### Iteration 106 - in progress (2026-06-09)

**Goal:** Deduplicate review-loop run cache updates from repeated backend
events.

**Rationale:** `useEventBridge` upserts PR-review runs by id but appends task
review-loop runs blindly. If the backend emits the same `review_loop_updated`
payload more than once, the selected task's review-run cache can show duplicate
entries. The event bridge should use the same id-based list update helper for
both review-run streams.

**Docs checked:** Context7 `/tanstack/query` `setQueryData` docs. Current
guidance treats cache writes as synchronous immutable updates and notes that
updater functions create cache entries when they return data.

**Claimed files:**
- `src/hooks/useEventBridge.ts`
- `src/hooks/useEventBridge.test.tsx`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: fire the same `review_loop_updated` event with the same
  `reviewRun.id` twice and run `pnpm vitest run src/hooks/useEventBridge.test.tsx`;
  it should fail while the cache holds duplicate runs.
- Focused green: rerun `pnpm vitest run src/hooks/useEventBridge.test.tsx`
  after replacing append with id-based upsert.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useEventBridge.test.tsx` failed as
  expected before implementation; duplicate `review_loop_updated` events
  produced `[21, 21]` in the review-run cache.
- Focused green `pnpm vitest run src/hooks/useEventBridge.test.tsx` passed:
  1 file / 7 tests.
- `pnpm verify` passed: frontend tests (70 files / 418 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `a3a2dbf` (`fix(ui): dedupe review loop run events`) pushed to
`origin/main`.

### Iteration 107 - in progress (2026-06-09)

**Goal:** Surface guidance when starting a session without any available agent
profile.

**Rationale:** `useSessionCommands.startSession` resolves the task/default
agent profile before entering the guarded action. When no profile exists, it
returns silently, leaving any stale message in place and giving the user no
reason the Start button did nothing. The command should clear stale state by
setting a concrete guidance message.

**Docs checked:** Context7 `/reactjs/react.dev` `useCallback` docs. Current
guidance keeps callback dependencies explicit and uses setter callbacks for
state updates inside memoized callbacks.

**Claimed files:**
- `src/hooks/useSessionCommands.ts`
- `src/hooks/useSessionCommands.test.tsx`
- `docs/features.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: extend the no-agent-profile test to expect a guidance message and
  run `pnpm vitest run src/hooks/useSessionCommands.test.tsx`; it should fail
  while the stale message remains.
- Focused green: rerun `pnpm vitest run src/hooks/useSessionCommands.test.tsx`
  after setting the guidance message in the early return.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useSessionCommands.test.tsx` failed as
  expected before implementation; the no-agent-profile path left the previous
  `"stale"` message in place instead of showing guidance.
- Focused green `pnpm vitest run src/hooks/useSessionCommands.test.tsx` passed:
  1 file / 5 tests.
- `pnpm verify` passed: frontend tests (70 files / 418 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `6e28a14` (`fix(ui): guide missing agent profile starts`) pushed to
`origin/main`.

### Iteration 108 - in progress (2026-06-09)

**Goal:** Clear stale pending updater state before a fresh update check.

**Rationale:** `useAppUpdate` stores the installable Tauri `Update` object in a
ref after a successful check. If a later manual check fails, the hook reports
`error` but keeps the old pending update object. A still-visible old toast
action could call `installUpdate()` and install the stale result. A fresh check
should invalidate the previous install target before reading the endpoint.

**Docs checked:** Context7 `/tauri-apps/plugins-workspace` updater docs. The
documented JavaScript flow is `const update = await check()` followed by
`await update.downloadAndInstall()` for that returned update object, so the
install target should come from the current successful check, not an older
result after a failed re-check.

**Claimed files:**
- `src/hooks/useAppUpdate.ts`
- `src/hooks/useAppUpdate.test.tsx`
- `docs/features.md`
- `docs/tracking-and-debugging.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a hook test where an update is found, a later check fails, and
  `installUpdate()` must not call the old pending updater object; run
  `pnpm vitest run src/hooks/useAppUpdate.test.tsx`.
- Focused green: rerun `pnpm vitest run src/hooks/useAppUpdate.test.tsx` after
  clearing pending update state at the start of each check.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppUpdate.test.tsx` failed as
  expected before implementation; after a failed re-check, `info` still held the
  old version `0.2.0`.
- Focused green `pnpm vitest run src/hooks/useAppUpdate.test.tsx` passed:
  1 file / 8 tests.
- `pnpm verify` passed: frontend tests (70 files / 419 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `f743158` (`fix(update): clear stale pending check state`) pushed to
`origin/main`.

### Iteration 109 - in progress (2026-06-09)

**Goal:** Make overlapping update checks last-request-wins.

**Rationale:** `useAppUpdate.check()` can be called while a prior silent or
manual check is still in flight. Today an older, slower check can resolve after
a newer check and overwrite the newer status/info. The hook should ignore stale
check completions so the UI reflects the latest requested check.

**Docs checked:** Context7 `/reactjs/react.dev` async effect guidance. Current
React docs recommend guarding async completions with an ignore/cancellation flag
so stale responses cannot update state after a newer request supersedes them.

**Claimed files:**
- `src/hooks/useAppUpdate.ts`
- `src/hooks/useAppUpdate.test.tsx`
- `docs/features.md`
- `docs/tracking-and-debugging.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a hook test with a slower launch check resolving after a newer
  manual check; run `pnpm vitest run src/hooks/useAppUpdate.test.tsx` and see the
  stale result overwrite the newer status.
- Focused green: rerun `pnpm vitest run src/hooks/useAppUpdate.test.tsx` after
  adding a request-id guard to ignore stale check completions.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppUpdate.test.tsx` failed as
  expected before implementation; the older launch check resolved late and
  changed status from the newer `upToDate` result back to `available`.
- Focused green `pnpm vitest run src/hooks/useAppUpdate.test.tsx` passed:
  1 file / 9 tests.
- `pnpm verify` passed: frontend tests (70 files / 420 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `6dd2cd1` (`fix(update): ignore stale check responses`) pushed to
`origin/main`.

### Iteration 110 - in progress (2026-06-09)

**Goal:** Use the system color scheme while app settings are still loading.

**Rationale:** `useAppTheme` treats `settings?.theme === undefined` as an
explicit non-system theme, which removes dark mode before settings hydrate. The
persisted default is System, so the pre-settings fallback should also follow the
OS color scheme and subscribe to future color-scheme changes.

**Docs checked:** MDN `prefers-color-scheme` and `Window.matchMedia()` docs. The
current docs describe `prefers-color-scheme` as the way to detect the user's
requested light/dark theme and `matchMedia()` as returning a `MediaQueryList`
that can be monitored with a `change` event.

**Claimed files:**
- `src/hooks/useAppTheme.ts`
- `src/hooks/useAppTheme.test.tsx`
- `docs/features.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a hook test rendering without settings while the system query
  reports dark; run `pnpm vitest run src/hooks/useAppTheme.test.tsx` and see it
  fail because the hook does not query system theme.
- Focused green: rerun `pnpm vitest run src/hooks/useAppTheme.test.tsx` after
  defaulting the missing theme to `system`.
- Full gate: `pnpm verify`.

**Status:** verified and committed.

**Evidence:**
- Red check `pnpm vitest run src/hooks/useAppTheme.test.tsx` failed as expected
  before implementation; rendering without settings left the root without the
  `dark` class even though the system query reported dark.
- Focused green `pnpm vitest run src/hooks/useAppTheme.test.tsx` passed:
  1 file / 7 tests.
- `pnpm verify` passed: frontend tests (70 files / 421 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

**Commit:** `09744f7` (`fix(ui): honor system theme before settings load`) pushed
to `origin/main`.

### Iteration 111 - in progress (2026-06-09)

**Goal:** Prevent PR-review form submission when no reviewer profile is
available.

**Rationale:** `ReviewsPage` can call `onCreateReview` with an empty reviewer
list if the URL is filled but the frontend has no selectable reviewer profile.
The backend has a fallback/default guard, but the controlled form already knows
the submission cannot be satisfied from the UI and should leave the submit action
disabled/no-op.

**Docs checked:** Context7 `/reactjs/react.dev` form state examples. Current
React docs show submit handlers calling `preventDefault()` and controlled forms
driving button disabled state from component state such as empty input or
submitting status.

**Claimed files:**
- `src/components/ReviewsPage.tsx`
- `src/components/ReviewsPage.test.tsx`
- `docs/features.md`
- `CODEX_ROLLING_UPDATES.md`

**Verification plan:**
- Red check: add a ReviewsPage test with no agent profiles and a filled PR URL;
  run `pnpm vitest run src/components/ReviewsPage.test.tsx` and see the button
  remain enabled / submit call happen.
- Focused green: rerun `pnpm vitest run src/components/ReviewsPage.test.tsx`
  after deriving a reviewer-available guard for the button and submit handler.
- Full gate: `pnpm verify`.

**Status:** verified; ready to commit.

**Evidence:**
- Red check `pnpm vitest run src/components/ReviewsPage.test.tsx` failed as
  expected before implementation; the Review PR submit button was enabled with
  no reviewer profiles available.
- Focused green `pnpm vitest run src/components/ReviewsPage.test.tsx` passed:
  1 file / 7 tests.
- `pnpm verify` passed: frontend tests (70 files / 422 tests), frontend build,
  Rust tests (241 tests), `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings`.

---

## Backlog / future work

- Audit remaining custom async/loading hooks only when new code introduces a real
  ownership mismatch; the existing high-value hook coverage is mostly harvested.
- Re-check terminal decoding docs against the recent UTF-8 boundary fixes.
- Keep future bundle work tied to measured `pnpm build` output; the current
  shell/task-workspace splits remove the warning-size chunks.
- Periodically diff the command/event/table reference against source after
  backend changes.
