# Design Archive (point-in-time)

This directory is a **dated archive** of pre-implementation design records produced
during feature work:

- `specs/` — short design specs written before building a feature.
- `plans/` — step-by-step implementation plans.

**These are historical, not current truth.** Each file is accurate *as of its date*
and captures the *intent* behind a feature — including rejected alternatives,
scope boundaries, and captured CLI-output fixtures — that the maintained docs do
not record. Where the final implementation later diverged (e.g. the auto-update
release flow, or the dissolved `useApp` hook), **the maintained docs win.**

For current behavior and structure, start with [`../architecture.md`](../architecture.md)
and the [documentation index](../architecture.md#documentation-index). Do not treat
anything here as a description of how the app works today.

> Two specs are still live: `specs/2026-06-06-multi-repo-workspaces-design.md`
> (Increment B — per-repo diffs and per-repo PRs) remains the spec-of-record for
> unbuilt work and is referenced from [`../features.md`](../features.md), and
> `specs/2026-06-11-unify-projects-into-workspaces-design.md` (with its plan in
> `plans/`) describes the proposed, not-yet-built projects→workspaces unification.
