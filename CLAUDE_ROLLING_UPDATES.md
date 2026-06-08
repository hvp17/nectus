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

## Backlog / future work (candidate improvements, not yet started)

- Audit other `package.json` deps for unused entries (e.g. confirm `cmdk`,
  `next-themes`, `tw-animate-css` are actually referenced).
- Survey largest files for cohesion splits: `src/AppRouter.tsx` (729),
  `native/src/sessions/mod.rs` (1463), `native/src/lib.rs` (1218) — only if a
  clean seam exists; do not split for the sake of line count.
- Look for duplicated logic that could move into a shared helper.
- Documentation drift: verify `docs/` matches current command/event lists.
