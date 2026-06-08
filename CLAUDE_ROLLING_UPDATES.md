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

## Backlog / future work (candidate improvements, not yet started)

- Audit other `package.json` deps for unused entries (e.g. confirm `cmdk`,
  `next-themes`, `tw-animate-css` are actually referenced).
- Survey largest files for cohesion splits: `src/AppRouter.tsx` (729),
  `native/src/sessions/mod.rs` (1463), `native/src/lib.rs` (1218) — only if a
  clean seam exists; do not split for the sake of line count.
- Look for duplicated logic that could move into a shared helper.
- Documentation drift: verify `docs/` matches current command/event lists.
