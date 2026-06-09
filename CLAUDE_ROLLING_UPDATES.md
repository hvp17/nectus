# Claude Rolling Updates

> Working log for the Claude improvement loop. A parallel agent keeps
> `CODEX_ROLLING_UPDATES.md`. **Before each commit**: read that doc + `git pull
> --rebase`, and avoid touching files/areas it is actively changing.

## Standing directives (from the user — highest priority)

1. **Align with shadcn as much as possible.** Adopt shadcn primitives over custom
   markup; install missing *default* shadcn components and use their exported APIs.
   **Exception:** keep the user's theme/redesign CSS (`src/styles.css` tokens, the
   `nx-`/surface CSS). Do not force `<Button>`/etc. onto heavily theme-styled custom
   surfaces (e.g. `nx-rail-btn`, `nx-fly-row`, `diff-file-row`) where it only adds
   override fights — that is *not* simpler.
2. **Keep code extremely simple and super easy to follow.** No clever/complicated
   techniques. Prefer readable best practices: early returns over deep nested
   ternaries, small named helpers, obvious control flow.

## Conventions

- One contained, verified improvement per iteration. Verify with `pnpm test`,
  `pnpm build`, and (when Rust changes) `cd native && cargo test` before commit.
- Prefer simplification, shadcn alignment, dead-code/dep removal, doc accuracy, and
  small architecture cleanups. No behavior changes without explicit need.
- Always `git pull --rebase origin main` before pushing; resolve in Claude's favor
  only for files Claude owns this iteration, otherwise keep Codex's version.

## ⚠️ Shared working tree (critical)

Claude and Codex operate in the **same checkout and the same git index**. A plain
`git add` + `git commit` will sweep up whatever the *other* agent has staged
(this already produced "coalesced" commits `bdccc36`/`ba2c20f`). To commit only
your own files and never capture the other agent's in-progress work:

- **Always commit by explicit pathspec:** `git commit -- <my files…>` (this
  disregards staged content of other paths). **Never `git add -A` / `git add .`.**
- Touch only `CLAUDE_ROLLING_UPDATES.md` (never edit `CODEX_ROLLING_UPDATES.md`).
- Re-read `CODEX_ROLLING_UPDATES.md` + `git status` before each commit; skip any
  file the other agent currently has modified.

## Coordination ledger

- Files Claude is likely to touch: `package.json`, `pnpm-lock.yaml`, `CLAUDE.md`,
  `src/**`, `native/**`, `docs/**`.
- If Codex's doc claims an area, Claude steps to a different one.
- **Codex iter 1** landed `1cb6070` (GitHub PR detection → TanStack Query;
  removed `useAsyncEffect.ts`). Codex owns the Query/Zustand boundary work.
- **Codex iter 2 (in progress)** claims `src/test/setup.ts` + `docs/features.md`
  (stale router-era refs). **Claude: do not touch those two files this round.**
- Codex backlog: large-file cohesion splits (`AppRouter.tsx`,
  `native/src/sessions/mod.rs`, `native/src/lib.rs`), async/loading-hook audit.
  Claude steers clear of those; Claude's lane is **shadcn alignment + readability**.

---

## Iteration log

### Iteration 1 — done (2026-06-09) · commit pending

**Goal:** Remove the unused `@tanstack/react-router` dependency.

**Rationale:** `CLAUDE.md` explicitly documents that `@tanstack/react-router` is
unused ("the package is unused and can be dropped from `package.json`"). Verified
with `grep` — it appears nowhere in `src/` or `native/`, only in `package.json`
and `pnpm-lock.yaml`. It is a lockfile leaf (depends only on react/react-dom), so
removal does not cascade.

**Changes:**
- Drop `@tanstack/react-router` from `package.json` dependencies.
- Regenerate `pnpm-lock.yaml` via `pnpm install`.
- Update the stale note in `CLAUDE.md`/`AGENTS.md` (remove the "can be dropped"
  sentence now that it is done).

**Verification:** `pnpm test` (45 files, 288 tests pass), `pnpm build` (ok).
`pnpm install` removed 9 packages; `pnpm-lock.yaml` has 0 react-router refs.

**Status:** committed as below.

---

### Iteration 2 — done (2026-06-09) · commit pending

**Goal (directive 2 — simplicity):** Replace `UpdateCard`'s 5-level nested ternary
(`detail`) with a readable `detailMessage()` helper using early returns, mirroring
the existing `statusLabel()` switch in the same file.

**Why:** The nested ternary was hard to follow; early-return "first match wins" reads
top-to-bottom. No behavior change — same strings, same order.

**Scope:** `src/components/settings/UpdateCard.tsx` only (1 file).

**Verification:** `pnpm test`, `pnpm build`.

**Status:** committed as below.

**Shadcn-alignment audit (for future iterations):**
- App is already heavily shadcn-aligned: stage toggle uses `ToggleGroup`, settings
  use `Button`/`Badge`/`Field`, overlays use `Dialog`/`Sheet`/`Tooltip`/`Popover`.
- Raw `<button>` remaining are mostly theme-styled custom surfaces (`nx-rail-btn`,
  `nx-fly-row`, `nx-jira-create`, `diff-file-row`) — leave them (directive 1
  exception). `PullRequestChecks.tsx` has a utility-styled disclosure button worth a
  closer look (possible `Button variant="ghost"` or a `Collapsible` primitive).
- `Collapsible` and `Progress` are default shadcn components NOT yet vendored;
  candidates if a real hand-rolled equivalent appears (PR-checks expander; the
  updater download bar is text-only today).
- `kbd.tsx` is vendored but unused; tooltip CSS targets `data-[slot=kbd]`. Leave it
  (it composes with Tooltip; removing reduces the palette, against directive 1).

### Iteration 3 — done (2026-06-09) · commit pending

**Goal (directive 2 — simplicity):** Replace the dense 4-way nested ternary that
computed `workflowStep` in `TaskWorkspace.tsx` with a named `currentWorkflowStep()`
helper (early returns + a doc comment explaining what steps 1/2/3 mean).

**Why:** `task.status === "done" || task.prUrl ? 3 : reviewInProgress ? 1 :
reviewReadyForNextStep ? 2 : 1` is hard to parse and self-documents nothing. The
helper reads top-to-bottom and names the conditions. No behavior change (the
"runs task workflow actions from the sidebar stepper" test still passes).

**Scope:** `src/components/TaskWorkspace.tsx` only.

**Shadcn note:** Evaluated adopting the default `Collapsible` primitive for the
`PullRequestChecks` disclosure but rejected it — the test/a11y rely on the toggling
"Show check details" name and the chevron needs the open boolean, so Collapsible
would keep the `useState` (no win) or force a11y/test churn. Left as-is per
directive-1 exception ("don't force shadcn where it adds complexity").

**Verification:** `pnpm test` (46 files, 291 tests), `pnpm build` (ok).

**Status:** committed.

### Iteration 4 — done (2026-06-09) · commit pending

**Goal (directive 2 + best practices):** Clarify the model-mapping logic in
`toProfileDraft` and cover its untested branches.

**Changes:**
- `profileDrafts.ts`: replaced the line that computed `presets.includes(model)`
  twice and nested a bare-truthy ternary with two named booleans (`isPreset`,
  `isCustomModel`) and a comment. Behavior-identical for all three cases (preset /
  free-text custom / empty).
- `profileDrafts.test.ts`: added two tests — free-text model → `__custom` sentinel
  + kept text; null model → both fields empty. These branches had no coverage.

**Verification:** `pnpm test` (46 files, 294 tests), `pnpm build` (ok).

**Status:** committed.

### Iteration 5 — done (2026-06-09) · commit pending

**Goal (directive 2 — simplicity):** Replace the 5-branch nested ternary that built
`createPullRequestDescription` in `TaskWorkspace.tsx` with a named
`pullRequestActionHint()` helper (early returns), mirroring `currentWorkflowStep()`.

**Why:** Same nested-ternary smell as iteration 3, in a user-facing hint string. The
helper reads top-to-bottom and names each branch's condition. Same strings, same
order — no behavior change.

**Scope:** `src/components/TaskWorkspace.tsx` only.

**Verification:** `pnpm test` (46 files, 296 tests), `pnpm build` (ok).

**Status:** committed.

**Note:** shadcn alignment is already strong — no native `<select>`, checkbox,
radio, or `<input>` outside `components/ui` (all form controls use shadcn). Future
shadcn work needs careful per-surface theme judgment, not blanket swaps.

### Iteration 6 — done (2026-06-09) · commit pending

**Goal (directive 2 — simplicity):** Replace the nested ternary that built the board
heading in `Workspace.tsx` with a named `boardHeaderTitle()` helper (early returns).

**Why:** `workspaceName ?? (selectedRepo ? selectedRepo.name : loading ? "Loading
projects…" : "Connect a project")` requires parsing three conditions at once. The
helper reads top-to-bottom. Behavior preserved exactly — `!== undefined` matches the
original `??` (nullish) semantics for the `string | undefined` type.

**Scope:** `src/components/Workspace.tsx` only.

**Provenance:** confirmed by a read-only Explore sweep of `src/components/**` +
`src/lib/**` (excluding Codex-owned `queries/`, `useGithub/useTaskDiff/usePrReviews`,
`docs/`, and the `ui/` palette) — this was the *only* high-bar readability win the
sweep surfaced. The codebase is otherwise clean. **Loop note:** the easy
readability fruit is now exhausted; future iterations should shift to other value
sources (test-coverage gaps for untested `lib/` pure functions, doc accuracy in
non-Codex docs, or a researched shadcn enhancement) rather than mining ternaries.

**Verification:** `pnpm test` (47 files, 297 tests), `pnpm build` (ok).

**Status:** committed.

### Iteration 7 — done (2026-06-09) · commit pending

**Goal (best practices — coverage):** Add `src/lib/composerForm.test.ts` covering
the worktree branch-name helpers, which had zero tests.

**Why:** `resolveWorktreeBranchName` / `getSuggestedWorktreeBranchName` drive a
documented Product Default (worktree branch naming) and are easy to regress. Tests
lock in: typed name wins (trimmed); empty/whitespace falls back to the suggested
`prefix+id`; a name equal to the bare prefix also falls back; no-prefix uses the
typed name verbatim; `createBranchIdentifier` is `task-`-prefixed and unique.
Pure test addition — **no production code changed** (lowest possible risk).

**Scope:** new file `src/lib/composerForm.test.ts` (9 tests).

**Verification:** `pnpm vitest run src/lib/composerForm.test.ts` (9/9); full
`pnpm test` (48 files, 307 tests); `pnpm build` (ok).

**Coordination note:** A full-suite run briefly showed 1 failure that was Codex's
*in-progress* `useJira` edit, not mine — verify own changes in isolation first; a
pure test-file addition cannot break other suites.

**Status:** committed.

### Iteration 8 — done (2026-06-09) · commit pending

**Goal (best practices — coverage):** Cover `formatAttentionReason` and
`getTaskAttention` in `sessionAttention.test.ts` — the existing suite tested
`upsertTaskAttention`/`getAttentionCounts`/`clearTaskAttention` but not these two.

**Why:** `formatAttentionReason` renders the user-facing "needs you" reason
(snake_case → Title Case, empty → "Needs input") and had no test. Added 4 cases
(empty/null fallback, snake_case→Title Case, single word) plus a `getTaskAttention`
found/absent test. Pure test addition — **no production change**.

**Scope:** `src/sessionAttention.test.ts` only (now 6 tests).

**Verification:** isolation `pnpm vitest run src/sessionAttention.test.ts` (6/6);
`pnpm build` (tsc type-checks tests — ok).

**Status:** committed.

### Iteration 9 — done (2026-06-09) · commit pending

**Goal (directive 1 — shadcn alignment):** Replace the hand-rolled disclosure in
`PullRequestChecks` with the default shadcn `Collapsible` primitive.

**Why:** The PR-checks drill-down was a hand-rolled `useState` + manual
`aria-expanded` + `{expanded && …}` disclosure — exactly what `Collapsible`
provides. Per CLAUDE.md ("don't reimplement what shadcn provides") this is the
canonical primitive. Installed it via the shadcn CLI (`pnpm dlx shadcn@latest add
collapsible` → `src/components/ui/collapsible.tsx`, radix-ui unified, no
package.json/lock change since radix-ui already bundles Collapsible).

**Changes:**
- New `src/components/ui/collapsible.tsx` (CLI-generated, matches the project's
  `radix-ui` primitive style).
- `PullRequestChecks.tsx`: removed `useState`; the trigger is `CollapsibleTrigger`
  (Radix supplies `aria-expanded`), the chevron rotates via
  `group-data-[state=open]:rotate-90`, content is `CollapsibleContent` (unmounts
  when closed, same as the old `{expanded && …}`). Non-expandable case early-returns
  the counts only. a11y: static `aria-label="Toggle check details"` + Radix
  `aria-expanded` (more correct than the old label that lied once expanded).
- `GitHubPanel.test.tsx`: trigger name `/show check details/i` → `/toggle check
  details/i` (the only assertion affected; behavior identical).

**Docs checked (step 7):** Context7 `/shadcn-ui/ui` Collapsible — confirmed the
`group` trigger + `group-data-[state=open]` chevron pattern and uncontrolled usage.

**Verification:** isolation `pnpm vitest run src/components/GitHubPanel.test.tsx`
(10/10); full `pnpm test` (49 files, 312 tests); `pnpm build` (ok).

**Status:** committed.

### Iteration 10 — done (2026-06-09) · commit pending

**Goal (best practices — coverage):** Add `src/statusLabels.test.ts` for the two
untested functions in `statusLabels.ts`.

**Why:** `isReviewLoopActive` (gates review UI in TaskWorkspace) and
`prReviewVerdictKey` (normalizes PR-review verdicts for display/tone) had no tests.
Covered: active while running/reviewing, false for the four terminal statuses
(passed/feedback_sent/error/stopped); verdict key keeps passed/blockers/
inconclusive and falls back to inconclusive for null/undefined. Pure test
addition — no production change.

**Scope:** new file `src/statusLabels.test.ts` (4 tests).

**Verification:** isolation 4/4; `pnpm build` (ok).

**Status:** committed.

**Loop status:** Frontend readability + shadcn-alignment wins are now exhausted
(Explore-confirmed; Collapsible adopted in iter 9). Rust backend surveyed
(github.rs etc.) — genuinely clean, well-tested, nothing to change. Remaining value
is incremental: targeted coverage of untested pure logic + real doc-drift fixes.
Cadence should slow to deliberate, genuinely-valuable changes — avoid churn.

### Iteration 11 — done (2026-06-09) · commit pending

**Goal (docs accuracy):** Fix real command-reference drift in
`docs/tracking-and-debugging.md` (the doc that bills itself as the "authoritative,
exhaustive command and event reference").

**Method:** Extracted the 54 commands actually registered in `generate_handler!`
(`native/src/lib.rs`) and diff'd against the doc. Two registered commands were
undocumented: `jira_create_work_item` and `post_pr_review_comment`. Read both impls
to write accurate descriptions, then added them to the JIRA and PR-review tables.
Reverse check (documented-but-not-registered) found only false positives (table/
event/update-status names in backticks) — no stale command entries. The earlier
"eight events" claim was also re-verified as accurate.

**Scope:** `docs/tracking-and-debugging.md` only (2 table rows). No code change.

**Status:** committed.

### Iteration 12 — done (2026-06-09) · verification + audit checkpoint

**Goal:** With both agents rapidly changing `main`, verify the combined state and
finish the doc-accuracy audit (loop step 2 + the CLAUDE.md verification gate).

**Verification gate (green across the board):**
- `pnpm test` — 49 files / 312 tests pass.
- `pnpm build` — ok.
- `cd native && cargo test` — 240 tests pass.

**Doc-accuracy audit (drift-diff vs source):**
- Events: the documented 8 match the Rust `emit` sites exactly. ✓
- Commands: 54 in `generate_handler!`; 2 were undocumented → fixed in iter 11. ✓
- SQLite tables: all 12 `CREATE TABLE`s appear in the doc. ✓

**Dead-code sweep (no action — all false positives):** `useGuardedAction` is used
in 9 hooks (only its unused `GuardedRun` *type* export is idle — harmless);
`useIsMobile` belongs to the vendored `sidebar` palette primitive (kept per
directive 1); `resolveRedirect` is preview-only seed machinery. Removing any would
be churn against clean, intentional code.

**Conclusion:** the codebase is genuinely clean and well-tested on both the
frontend and Rust sides; the obvious wins are harvested. Remaining value is
incremental and requires deeper investigation per pass — cadence should stay
deliberate, not churn.

### Iteration 13 — done (2026-06-09) · commit pending

**Goal (best practices — coverage of critical infra):** Add
`src/hooks/useGuardedAction.test.ts`. `useGuardedAction` is the app's central
async wrapper (clear message → optional busy → run → surface `String(error)` →
optional rethrow → always reset busy) used by **9 hooks**, and it had no test.

**Covers:** success returns the action's result + clears the message; a thrown
error is surfaced as the message and returns `undefined`; `rethrow` re-throws
after surfacing; `busy` toggles true→false around the action and still resets on
failure (the `finally`); busy is left alone when not requested. Pure test
addition — no production change.

**Scope:** new file `src/hooks/useGuardedAction.test.ts` (5 tests).

**Verification:** isolation 5/5; `pnpm build` (ok).

**Status:** committed.

**Note:** verified the `void`/fire-and-forget async sites are all sound (wrapped in
`run()`, have `.catch` reverts, or are intentionally non-critical) — no
silent-failure fixes warranted. Error handling across the app is disciplined.

### Iteration 14 — done (2026-06-09) · commit pending

**Goal (best practices — failure-path coverage):** Add
`src/hooks/useSidebarCollapse.test.tsx` for the recently-shipped sidebar-collapse
feature's optimistic-write + revert-on-failure logic.

**Why:** `useSidebarCollapse` writes the repos/workspaces query cache optimistically
for an instant fold, persists via `api.set{Repo,Workspace}Collapsed`, and reverts
the cache if that write rejects. The revert is the easy-to-break, hard-to-notice
part and had no test. Covered: optimistic fold lands + persists; cache reverts when
the repo persist fails; cache reverts when the workspace persist fails. Uses the
project's `createQueryClient` + `QueryClientProvider` + mocked `api` pattern.

**Scope:** new file `src/hooks/useSidebarCollapse.test.tsx` (3 tests).

**Verification:** isolation 3/3; `pnpm build` (ok).

**Status:** committed.

### Iteration 15 — done (2026-06-09) · commit pending

**Goal (best practices — safety-path coverage):** Add
`src/hooks/useTaskDeletion.test.tsx` for the deletion *safety* logic the happy-path
integration test (`appTaskBoardTests`) doesn't cover.

**Why:** `useTaskDeletion` refuses to delete a task with a running session (a real
footgun guard) and force-discards a worktree's changes only when
`hasWorktree && isDirty`. Neither was tested. Covered: blocked-with-session shows the
error toast and never calls `api.deleteTask`; a dirty worktree task calls
`deleteTask(id, true)`; a clean task calls `deleteTask(id, false)`. The `deleteTask`
call is synchronous (before the first `await`), so the asserts need no async/store
setup.

**Scope:** new file `src/hooks/useTaskDeletion.test.tsx` (3 tests).

**Verification:** isolation 3/3; full `pnpm test` (57 files, 345 tests); `pnpm build`.

**Status:** committed.

**Plateau note:** remaining untested hooks are thin api-wrappers (low value — would
only assert wiring) or Codex-adjacent/complex (`useComposer`, `useJiraBoardView`).
The high-value, collision-free coverage is now done. Further iterations shift to
monitoring new code as it lands rather than mining the (clean) existing code.

### Iteration 16 — done (2026-06-09) · 100-commit review + regression fix

**Goal (user request):** Review the last 100 commits on `main` for correctness.

**Method:** Ran the full gate on the cumulative state (frontend **431 tests** +
build, Rust **242 tests** — all green) and reviewed all 100 commit diffs via four
parallel review agents (25 each).

**Result:** 99/100 correct. The 29 `fix`, 30 `refactor`, 4 `perf`, and 24 `test`
commits were verified message-matches-diff and behavior-preserving — including the
JIRA optimistic-rollback fixes (`removeQueries` vs orphaned `[]`), the `skipToken`/
`useOptionalQuery` empty-query elimination, the agent-profile `resolveAgentProfileId`
validation, the git `augmented_path` fix, and the `rustfmt`-only `style(rust)` commit.

**One real regression found + fixed:** `ce99fbc perf(router): lazy-load on-demand
overlays` made `CommandPalette` mount only while open, but the global ⌘K listener
lived **inside** the palette — so ⌘K could no longer open it from the closed state
(only the IconRail search button could). The unit test masked it by rendering the
palette always-mounted.

**Fix (this iteration):**
- New `src/hooks/useCommandPaletteShortcut.ts` — the global ⌘K/Ctrl+K toggle in the
  always-mounted shell (`AppLayout`), keeping the lazy-load perf win.
- Removed the dead listener from the lazy `CommandPalette`; fixed the now-stale
  "mounted once" comment in `AppRouter`.
- Moved + strengthened the tests: `useCommandPaletteShortcut.test.ts` now actually
  verifies open-from-closed and unmount cleanup (the old palette test could not).

**Verification:** full `pnpm test` (74 files, 432 tests), `pnpm build`.

**Status:** committed.

## Backlog / future work (deeper investigation — no quick wins left)

- Targeted coverage for any *new* untested logic as it lands (watch the diff).
- Periodic doc-drift re-checks after feature commits (events/commands/tables).
- Watch for hand-rolled patterns that map cleanly to shadcn primitives *without*
  fighting the `nx-` theme (the PR-checks `Collapsible` was the clear one).
- Large-file cohesion splits (`AppRouter.tsx`, `sessions/mod.rs`, `lib.rs`) — only
  if a genuine seam appears; Codex's lane, so coordinate first.
