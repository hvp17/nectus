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

### Iteration 2 - done (2026-06-09) - commit pending

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

**Status:** verified; committing.

**Evidence:**
- `pnpm test` passed (46 files, 290 tests).
- `pnpm build` passed.

---

## Backlog / future work

- After Claude finishes package cleanup, re-check stale router comments in
  `src/test/setup.ts` and `docs/features.md`.
- Audit remaining custom async/loading hooks against the Query/Zustand ownership
  boundary.
- Inspect large files only where a real cohesion split is visible:
  `src/AppRouter.tsx`, `native/src/sessions/mod.rs`, and `native/src/lib.rs`.
- Re-check terminal decoding docs against the recent UTF-8 boundary fixes.
