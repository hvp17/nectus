# Command Redesign — Rolling Plan & Progress

> Living tracker for adopting the "Command" (Linear/Raycast) design as first-class
> shadcn theming. Working doc on branch `feat/command-redesign`; fold into the
> permanent docs (or delete) when the effort lands. Prototype reference:
> `design-mockups/directions/command.html`.

## Decisions (locked)

- **Adopt the full Command theme** — indigo `--primary`, ~285° cool neutrals,
  flat/hairline surfaces, crisp radius, denser feel.
- **Both light + dark.**
- **⌘K command palette is in scope** (the one genuinely new build).
- **Rollout: Phase 0 token PR first**, then surface-by-surface; keep tests green.

## Why this is mostly a re-theme (research summary)

- ~95% of the custom `nx-` CSS is `var(--token)`-driven → retuning `:root`/`.dark`
  reskins the whole app + every shadcn primitive.
- 46 test files, **zero** color/radius/shadow assertions (only `layoutStyles.test.ts`
  checks layout). Tests key off `data-testid`/`role`/`aria` — preserve those.
- Almost every surface already exists structurally → restyle, not rebuild.
- Only net-new: the ⌘K palette (no `cmdk` dep, no global keydown today).
- Theme infra: `src/hooks/useAppTheme.ts` toggles `.dark` + honors system; density
  via `data-density`/`.density-compact`.

## Token mapping (Command → shadcn tokens, in `src/styles.css`)

| shadcn token | dark | light |
|---|---|---|
| `--primary` / `--ring` / `--sidebar-primary` | indigo `oklch(0.62 0.19 277)` | `oklch(0.55 0.20 277)` |
| neutrals (`--background/card/popover/secondary/muted`) | cool `~285°` obsidian steps | `~285°` near-white steps |
| `--accent` (subtle active bg) | `oklch(0.30 0.035 277)` | `oklch(0.95 0.03 277)` |
| `--border` / `--input` | `oklch(1 0 0 /0.08–0.13)` | `oklch(.22 .01 285 /0.12–0.16)` |
| `--status-success/warning/info` + **new `--status-review`** (violet ~300) | Command set | light-readable set |
| `--radius` | **0.5rem**, scale → multiplicative (`*0.6/*0.8/×1/*1.4`) → md≈6px, lg=8px | same |
| shadows | **flattened** (low opacity); aurora + dark card sheen removed | flattened |
| fonts | Geist / Geist Mono (unchanged) | unchanged |

## Phases

- [x] **Phase 0 — Token retune** (`src/styles.css`): rewrite `:root`/`.dark`,
  multiplicative radius scale, register `--color-status-review`, flatten shadows,
  drop `.app-shell` aurora + dark card sheen. *(done & verified — build clean, 1026 tests pass)*
- [x] **Phase 1 — First-class cleanup (core)** *(build clean, 1026 tests pass)*:
  added `Badge` `review` variant (`badge.tsx` + `redesign.css` `--status-review`
  rule); swapped `ReviewsPage` raw `<input>` → shadcn `Input`; tokenized the 2
  app-level `#fff` (rail badge, verdict dot). Left JIRA brand whites
  (`nx-jtype`/`nx-java`) intentionally. **Folded into their Phase 2 surface passes**
  (cleaner to do while restyling the surface): `IconRail` rail buttons → shadcn,
  reviewer chips → `Toggle`, `PrReviewDetail` verdict spans → `Badge`, `SettingsPage`
  nav buttons → shadcn.
- [ ] **Phase 2 — Per-surface fidelity** (restyle, in order): Mission Control →
  Board → Task (stage/ribbon/facts) → Settings → PR Reviews (matrix) → JIRA → composer.
- [ ] **Phase 3 — ⌘K command palette** (new): `cmdk` + `ui/command.tsx` + `ui/kbd.tsx`,
  global keydown hook, action registry wired to store
  (`setCurrentView`/`openWorkspaceBoard`/`setSelectedTaskId`/`setCreateTaskOpen`) +
  AppContext (`openTask`/`openCreateTaskModal`); header command-bar trigger.
- [ ] **Phase 4 — Polish**: indigo focus rings, contrast audit (both themes),
  delete dead `nx-` color CSS, run `pnpm test` + `pnpm build` + `cargo test`.

## Gotchas / guardrails

- Leave **JIRA brand colors** in `src/components/jiraVisuals.tsx`
  (TYPE/PRIORITY/AVATAR hex) — intentional external colors.
- Radius is a scale, not a number — verify md/lg land ~6/8px after the base change.
- Preserve every `data-testid` / `aria-label` / handler.
- Do not commit `design-mockups/` (scratch) with the app changes.

## Verification

- `pnpm test`, `pnpm build`, `cd native && cargo test` after each phase.
- Visual: user runs `pnpm dev --host 127.0.0.1` (per repo rule, agent does not
  auto-launch the dev server).

## Progress log

- **2026-06-08** — Branch `feat/command-redesign` created off `main`. Pulled latest
  shadcn Tailwind-v4 theming docs (confirmed multiplicative radius scale + token
  set). Plan doc created. Starting Phase 0 token retune.
- **2026-06-08** — **Phase 0 landed.** Rewrote `:root`/`.dark` in `src/styles.css`
  to Command tokens: indigo `--primary` (`oklch(.55 .20 277)` light / `.62 .19 277`
  dark) + `--ring`/`--sidebar-primary`; ~285° cool neutrals; `--accent` indigo tint;
  `--radius` 0.5rem with the multiplicative scale (md≈6px, lg=8px); flattened the
  shadow scale; removed the `.app-shell` aurora + dark card sheen; added
  `--status-review` (violet) + `--color-status-review`; retuned `--status-*` + charts.
  `pnpm build` clean (CSS 183 kB); `CI=true pnpm test` → **1026/1026 pass**.
  Next: Phase 1 — Badge `review` variant + wire verdict labels, swap hand-rolled
  controls (IconRail / ReviewsPage / PrReviewDetail / SettingsPage) to shadcn,
  fix 3 `#fff` literals in `redesign.css`.
- **2026-06-08** — **Phase 1 (core) landed.** `Badge` gains a `review` variant
  backed by `--status-review`; `ReviewsPage` PR-URL + rounds inputs now use shadcn
  `Input` (aligns with the form's `Button` height); rail-badge + verdict-dot `#fff`
  tokenized (JIRA brand whites left as intentional). The remaining control swaps
  moved into their Phase 2 surface passes. `pnpm build` clean; **1026/1026 tests pass**.
  Next: Phase 2 — Mission Control surface pass.
