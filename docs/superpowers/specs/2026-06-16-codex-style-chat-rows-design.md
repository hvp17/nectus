# Codex-style chat tool rows — design

**Date:** 2026-06-16
**Status:** approved (design); pending implementation plan
**Surface:** ACP chat transcript (`src/components/chat/*`, `src/lib/chat/*`, `src/components/ai-elements/tool.tsx`)
**Mockup:** `design-mockups/codex-chat-rows.html`

## Goal

Rework the chat transcript's tool-call rendering to match the Codex aesthetic: quiet,
low-contrast rows at rest; consecutive read/search calls collapsed into one summary
row; a richer command block with a success/failure badge; and edit rows that carry
their diff stats in the header and a real tinted diff on expand. Builds on the existing
compact-row work (`e1e321a`), not a rewrite.

## Scope

Four presentation/assembly changes, in priority order:

1. **Grouping consecutive read/search tool calls** into one summary row
   (`Read N files and searched code`) with a count pill, expanding to the individual
   operations. Commands and edits are **never** grouped — their badges and diff stats
   are the at-a-glance signal.
2. **Command rows** — terminal glyph, `Ran <cmd>` title, a corner `✓ Success` /
   `✗ Failed` / `Running…` badge, expanding to a card-elevated block showing
   `$ command`, stdout/stderr, and exit code.
3. **Edit rows** — pencil glyph, `Edited <file>` title, inline `+N −M` stats in the
   header, expanding to the new file text (`file_edit.diff`, the only diff data the
   model carries — there is no `old_text`, so a true red/green unified diff is not
   possible client-side; the new text renders as an added/neutral code block). The
   title stays a button that opens the full Diff tab via `onOpenFile`.
4. **Resting style** — rows are near-transparent at rest, gaining a hairline border +
   faint card tint only on hover or when expanded.

Out of scope: changing the ACP/Rust model, the diff data source, or non-tool parts
(text, reasoning, permission, plan) beyond what grouping requires.

## Data model

No Rust/ACP changes. The normalized model already carries everything needed:

- `ChatPart` union (`src/types.ts:406-421`): `tool` (status, kind, title, locations,
  rawInput, output), `file_edit` (path, additions, deletions).
- `ChatToolStatus`: `pending | running | completed | failed` → drives the badge.
- `kind` distinguishes read/search/execute/edit; `locations[]` supplies the per-op
  paths for the grouped body.

Grouping is a **pure, presentation-time transform** over a message's `parts[]` — it
does not change what the cache stores or what events deliver. So `useEventBridge`,
`acp_manager.rs`, and the cache are untouched.

## Components

- **`src/lib/chat/groupToolParts.ts`** (new, pure) — folds a `ChatPart[]` into a
  render list: a maximal run of adjacent `tool` parts whose `kind` is read/search
  becomes one `ToolGroup` descriptor (`{ kind: "tool-group", parts, counts }`); every
  other part passes through unchanged. Adjacency breaks on any non-read/search part
  (text, command, edit, permission, plan), preserving transcript order. Unit-tested in
  isolation: empty, single, mixed, run-broken-by-text, all-grouped.
- **`src/lib/chat/renderChatParts.tsx`** (edit) — consumes the grouped list; adds a
  `tool-group` branch rendering the summary row + sub-list; routes `tool` parts by
  `kind` to command vs. read vs. generic presentation; `file_edit` gains the inline
  stats header + expandable diff.
- **`src/components/ai-elements/tool.tsx`** (edit) — extend the existing compact
  `Tool`/`ToolHeader` to support: a trailing **slot** (badge or stats), a **count
  pill**, the quieter resting style (transparent → bordered-on-open), and a `glyph`
  prop so each kind picks its lucide icon (`TerminalSquare`, `Search`, `FileText`,
  `Pencil`, spinning `Loader`).
- **`src/lib/chat/toolDisplayName.ts`** (reuse) — title shortening already exists.
- Styling: token-consuming Tailwind utilities only (`--status-success`,
  `--destructive`, `--muted-foreground`, `--card`, `--border`), per `styles.css` rules.
  No new colors, no surface CSS file.

## Grouping rule (precise)

- A part is **groupable** iff it is a `tool` part and its `kind` ∈ {read, search,
  grep, glob, list} (exact kind strings confirmed against `acp_manager.rs` during
  implementation; fall back to "title starts with Read/Search/Searched" only if `kind`
  is absent).
- Walk `parts[]` in order; accumulate maximal runs of groupable parts. A run of length
  ≥ 2 → one `ToolGroup`. A run of length 1 → render as a normal single read row (no
  pill). Any non-groupable part flushes the current run.
- Group title: `Read {fileCount} files` when all reads; `Read {n} files and searched
  code` when the run mixes reads + searches; count pill = total ops in the run.
- Group status: `failed` if any child failed, else `running` if any running, else
  `completed` — drives the summary glyph tint.

## Error handling / states

- **Running**: command/group glyph swaps to a spinning `Loader`; badge reads
  `Running…` in `--status-info`.
- **Failed**: badge `✗ Failed` + exit code in `--destructive`; command block stderr
  tinted; failed child inside a group surfaces the group as failed.
- **No body**: a row with no locations/output/input stays non-expandable (existing
  `expandable` prop), no chevron — unchanged behavior.

## Testing

- `groupToolParts` pure-function unit tests (the cases above).
- Component tests in the existing `renderChatParts`/transcript suite: a grouped run
  renders one row with the right count and expands to N sub-rows; a command row shows
  the success badge and `$ cmd`; an edit row shows `+N −M` and a diff on expand; a
  read run of length 1 is **not** grouped.
- `pnpm test` + `pnpm build` (strict TS) green before done.

## Verification

Spec-level only here; manual visual check happens in `pnpm desktop:dev` against a live
ACP chat once implemented, diffing each row against `design-mockups/codex-chat-rows.html`.
