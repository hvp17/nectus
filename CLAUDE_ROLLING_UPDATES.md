# Claude Rolling Updates

> Working log for the Claude improvement loop. A parallel agent keeps
> `CODEX_ROLLING_UPDATES.md`. **Before each commit**: read that doc + `git pull
> --rebase`, and avoid touching files/areas it is actively changing.

## Conventions

- One contained, verified improvement per iteration. Verify with `pnpm test`,
  `pnpm build`, and (when Rust changes) `cd native && cargo test` before commit.
- Prefer simplification, dead-code/dep removal, doc accuracy, and small
  architecture cleanups. No behavior changes without explicit need.
- Always `git pull --rebase origin main` before pushing; resolve in Claude's favor
  only for files Claude owns this iteration, otherwise keep Codex's version.

## Coordination ledger

- Files Claude is likely to touch: `package.json`, `pnpm-lock.yaml`, `CLAUDE.md`,
  `src/**`, `native/**`, `docs/**`.
- If Codex's doc claims an area, Claude steps to a different one.

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

**Status:** verified, committing.

---

## Backlog / future work (candidate improvements, not yet started)

- Audit other `package.json` deps for unused entries (e.g. confirm `cmdk`,
  `next-themes`, `tw-animate-css` are actually referenced).
- Survey largest files for cohesion splits: `src/AppRouter.tsx` (729),
  `native/src/sessions/mod.rs` (1463), `native/src/lib.rs` (1218) — only if a
  clean seam exists; do not split for the sake of line count.
- Look for duplicated logic that could move into a shared helper.
- Documentation drift: verify `docs/` matches current command/event lists.
