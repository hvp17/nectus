# CSS System Rework — Rolling Plan & Progress

> Living tracker for making the styling system coherent and best-practice after
> three stacked redesign generations left dead code, mixed vocabularies, and a
> precedence bug. Working doc on branch `chore/css-coherence`; fold the durable
> facts into `CLAUDE.md` + `docs/architecture.md` and delete this when it lands.
> Grounded in a 9-agent audit of all 7 CSS files (Context7 shadcn/Tailwind-v4
> research + per-selector alive/dead cross-reference).

## The problem (verified)

Three styling generations are layered on top of each other and never cleaned up:

1. **Legacy per-surface** (`task-*`, `settings-*`, `profile-*`, `nectus-sidebar`,
   `status-column`, `metrics`, `task-tree-*`) in `layout.css`, `detail.css`,
   `settings.css`, `task-board.css` — mostly dead.
2. **`nx-` redesign** in `redesign.css` (749 lines) — live, but ~52 dead selectors
   and a few shadcn reimplementations.
3. **Tailwind utilities + shadcn primitives** inline in JSX — the newest, cleanest
   approach (Task Workspace, Composer rebuilt this way).

Surfaces even **mix generations on one element** (`TaskCard` →
`className="task-card-shell nx-card group"`; `SettingsPage` → `nx-set*` shell +
`profile-*` content).

**Root cause beyond dead code (the key finding):** all six split CSS files are
**unlayered**. In Tailwind v4 (native cascade layers `theme → base → components →
utilities`, utilities last) **unlayered rules outrank every utility**. That is why
`task-board.css` needed `!important` ×6, why an `nx-` class can't be overridden by a
Tailwind utility on the same element, and why surfaces accreted inline `style={{}}`
and mixed classes as workarounds. Wrapping surface CSS in `@layer components` fixes
the precedence so utilities win again — this is what makes the system *coherent*,
not just smaller.

## Audit results (per file: alive / dead)

| File | Selectors | Alive | Dead | Verdict |
|---|---|---|---|---|
| `styles.css` | 22 | token layer | dead `.content-shell` fade + `nectus-fade-in` keyframe; ~11 self-referential `@theme inline` no-ops; dup `.app-shell` | **keep = token entry, clean** |
| `redesign.css` | 198 | 146 | 52 (`nx-ws*`, `nx-profile*`, `nx-term*`, `nx-insp*`, `nx-mini*`, `nx-actionbar`, `nx-meta`, `nx-fly` popover chrome, `nx-verdict`, `nx-in*`, `nx-fld*`) | **keep live, delete dead, `@layer`** |
| `layout.css` | 46 | 1 (`.app-shell`, dup) | 45 | **delete entire file** |
| `detail.css` | 38 | 10 | 28 (`task-terminal-*`, `task-inspector-*`, `task-meta-*`, `task-control-strip`, `task-session-*`, `task-status-*`, `task-delete-*`, `task-brief*`, `task-workflow-panel`, `task-review-*`, `review-panel`) | **shrink + `@layer`** |
| `settings.css` | 40 | 18 (`brand-logo*`, `profile-editor*`, `select-*-with-logo`) | 22 (all `settings-*`, `default-agent-*`, `profile-list`, `brand-logo-lg/custom`) | **shrink + `@layer`** |
| `task-board.css` | 11 | 6 | 5 (`status-column*`, `column-heading` ×2, `task-attention-line`, `task-attention-detail`, `task-review-line`) | **shrink, drop `!important`, `@layer`** |
| `diff.css` | 30 | 30 | 0 | **keep, `@layer`** |

Tests: only `layoutStyles.test.ts` asserts on dead CSS (the *text* of
`.dashboard-layout`/`.workspace-frame`) → delete it with `layout.css`.
`appTaskBoardTests.tsx` only touches the live `.task-drag-ghost`. The wider suite
keys off `data-testid`/`role`/`aria` (zero color/radius assertions — proven by the
prior redesign).

## Target architecture

- **`src/styles.css` = the single theme entry.** `@import "tailwindcss"`,
  `@custom-variant dark`, a **cleaned `@theme inline`** (only meaningful lines:
  the `--color-*` bridges incl. `--color-status-*`, the `--radius-*` calc ladder,
  `--font-*`, `--tracking-*` — drop identity no-ops and unused `--radius-2xl/3xl/4xl`),
  `:root`/`.dark` raw OKLCH tokens, `@layer base` reset, global chrome (scrollbars,
  `::selection`). One token home; no new colors/hex.
- **Per-surface CSS files, each wrapped in `@layer components`,** holding ONLY live
  Nectus-specific composition: `redesign.css` (shell/board/mission/reviews/jira),
  `detail.css` (terminal + workspace grid), `settings.css` (profile editor +
  brand-logo), `task-board.css` (card + drag), `diff.css`. Consume `var(--token)`,
  never hardcode color. Loaded after the entry so layer order is set first.
- **shadcn primitives** for anything generic (override via `className`/cva, never by
  editing `ui/*`); **Tailwind utilities** for one-offs; inline `style={{}}` only for
  genuinely dynamic per-render values (state dot colors, drag transforms).
- Add `test.exclude: ["**/.claude/**", …]` to `vite.config.ts` so the suite stops
  scanning nested worktrees (reliable verification baseline).

## Phases (each: edit → `pnpm build` + scoped `pnpm test` → commit)

- [x] **P0 — Baseline + test hygiene.** Clean baseline = **288 tests / 46 files**
  (the old "1026" was nested-worktree inflation); added `.claude` exclude to the
  vitest config in `vite.config.ts`.
- [x] **P1 — Dead-code removal (zero behavior change).** Deleted `layout.css` +
  `layoutStyles.test.ts` + its import; removed the 52/28/22/5 dead selectors from
  redesign/detail/settings/task-board; removed the dead `.content-shell` fade +
  `nectus-fade-in` keyframe from `styles.css` (`.app-shell` already lived only in
  `styles.css` once `layout.css` was deleted). **287 tests / 45 files green** (= 288
  − the one deleted dead-CSS test). `pnpm build` clean. Kept all conditional
  *modifiers* whose base class is alive (matrix `head`, cons-banner `warn/bad`,
  jira-key `done`, java `empty`) — grep can miss template-literal modifiers.
- [x] **P2 — Theme hygiene.** Cleaned `@theme inline`: dropped the unused
  `--radius-2xl/3xl/4xl`, the `--tracking-normal`/`--letter-spacing` identities, and
  the non-namespace `--shadow-offset-*`/`--shadow-blur/spread/opacity` lines (no such
  utilities exist); kept the load-bearing bridges (`shadow-sm/md/lg/xs`,
  `tracking-tight/wider/widest`, `font-heading/mono` are all used) and `--spacing`
  (removing it is risk-asymmetric — drives the whole spacing scale). Added a comment
  explaining what belongs in the block. 287/45 green; build clean.
- [x] **P3 — Cascade layers (the coherence fix).** Wrapped the three "plain-element"
  surface files (`redesign.css`, `detail.css`, `diff.css`) in `@layer components` so
  Tailwind utilities now win over them (the precedence fix). **Deliberately left
  `task-board.css` and `settings.css` unlayered** — their custom classes restyle
  shadcn primitives via unlayered precedence (`.attention-badge`/`.task-review-badge`
  override Badge's `font-medium`/variant colors; `.profile-editor*` override Card's
  `bg-card`/`py-3`/`gap-3` and `FieldGroup`'s flex). Layering them flips those
  (bold→medium badge text, green "passed" badge→gray, 2-col profile grid→1-col,
  card bg `--background`→`--card`). Migrating those overrides to utilities/cva is P4;
  until then unlayered preserves them exactly. The `!important` in `task-board.css`
  stays — all 6 are legitimate drag/selection runtime overrides, not the
  unlayered-CSS symptom. **Visually verified** Mission Control, Settings, and the
  Board in dark mode: layered surfaces render identically; unlayered badges/profile
  grid preserved. 287/45 green; build clean.
- [x] **P4 (badges) — migrate the Badge overrides, layer `task-board.css`.** Replaced
  `.attention-badge`/`.task-review-badge` with utilities (`font-extrabold`,
  `max-w-full`) in `TaskCard`; the "passed" review badge now sources its green from
  the `success` *variant* (whose color is byte-identical to the deleted
  `[data-status=passed]` override) via a local ternary — so the board is pixel-identical
  and the facts-rail is untouched. Deleted both badge rules and wrapped
  `task-board.css` in `@layer components` (its 6 `!important` are legitimate drag/
  selection runtime overrides, kept). Board badges visually verified identical
  (dark). 287/45 green; build clean. **Now 4 of 5 surface files are layered.**

### Remaining (deliberate follow-ups, out of this structural rework)

- [ ] **`settings.css` stays unlayered — documented exception.** The `.profile-editor*`
  suite restyles **five** shadcn primitives (Card, CardHeader, FieldGroup, Input via
  `.profile-name-input`, Badge via `.profile-status-badge`) by relying on unlayered
  precedence, and `.profile-status-badge` uses `color-mix(var(--agent-accent) …)` —
  a per-`data-agent-kind` dynamic color that **cannot** be expressed as a static
  Tailwind utility. Layering it cleanly needs a real `ProfileEditor` refactor (e.g. an
  accent-aware Badge cva variant) with light/dark/compact verification. Tracked, not
  rushed.
- [ ] **Optional polish.** Migrate `.nx-seg` → shadcn `ToggleGroup` (JIRA toolbar);
  fold `TaskCard`'s `task-card-shell`+`nx-card` (two rail mechanisms on one element)
  into one; convert static inline `style={{}}` (Reviews/PrReviewDetail/JiraCard) to
  utilities/tokens.
- [ ] **P5 — Docs + PR.** Update `CLAUDE.md` frontend map + `docs/architecture.md`
  styling section; open PR.

## Decision log

- Keep the **split-by-surface** file structure (shadcn/Tailwind research endorses it);
  the missing piece was the `@layer` wrapper, not consolidation into one file.
- Keep the **`nx-` prefix** as the single custom-class convention; do not invent a
  parallel system beside shadcn.
- **No visual/behavior change** is the bar for P1–P3 (pure structure/precedence
  hygiene). P4 may intentionally touch markup; verify each.

## Verification gates

`pnpm build` clean · `pnpm test` green (scoped, `--exclude '**/.claude/**'`) ·
`cd native && cargo test` unaffected · spot visual check both themes before PR.
