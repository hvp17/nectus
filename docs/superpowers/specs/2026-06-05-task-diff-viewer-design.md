# Task Diff Viewer — Design

Date: 2026-06-05

## Goal

Let the user see what an agent changed for a task without leaving the app. Today
the launch → review → PR pipeline has no way to inspect the actual code changes;
you drop to the terminal or GitHub. This adds an in-app diff viewer to the task
workspace.

## Scope (settled)

- **What to diff (option B):** the full task diff against the base branch — for a
  worktree task, the merge-base of the repo's default branch (`origin/HEAD`)
  through the working tree, i.e. committed **and** uncommitted changes, the same
  set the eventual PR will carry. Direct-edit tasks have no dedicated branch and
  fall back to working-tree-vs-`HEAD`.
- **Where it lives (option A):** a "Terminal | Diff" segmented control on the
  workspace stage. The diff gets the full stage when active; the facts rail is
  untouched. The Diff tab carries a changed-file count.

### Out of scope for V1 (YAGNI)

Working-tree-vs-branch toggle, inline comments, token-level syntax highlighting,
side-by-side view, diff virtualization.

## Backend (Rust)

### `native/src/git_ops.rs`

Pure, independently testable helpers built on the existing `git_output` helper:

- `pub struct DiffBase { pub label: String, pub commit: String }`
- `resolve_diff_base(path) -> Option<DiffBase>` — resolves the base entirely from
  local refs (no network): `git rev-parse --abbrev-ref origin/HEAD` → default
  branch label (e.g. `origin/main`); `git merge-base HEAD <default>` → base commit.
  Returns `None` when there is no usable base (callers then diff against `HEAD`).
- `diff_summary(path, base: Option<&str>) -> Result<Vec<DiffFileEntry>, String>` —
  with `base_ref = base.unwrap_or("HEAD")`:
  - tracked changes from `git diff --numstat -z <base_ref>` (additions, deletions,
    binary via `-`) merged by path with `git diff --name-status -z <base_ref>`
    (change kind + rename old path);
  - untracked files from `git ls-files --others --exclude-standard -z`, appended as
    `Untracked` entries (additions = line count by reading the file; binary when the
    content contains a NUL byte).
- `diff_file(path, base: Option<&str>, file) -> Result<String, String>` — the
  unified patch for one file. Tracked: `git diff <base_ref> -- <file>`. Untracked
  (detected via `git ls-files --others --exclude-standard -- <file>`):
  `git diff --no-index -- /dev/null <file>` run with `current_dir(path)`, tolerating
  its documented exit-1 (differences present).

### `native/src/models.rs`

```rust
enum DiffChangeKind { Added, Modified, Deleted, Renamed, Untracked }  // serde snake_case
struct DiffFileEntry { path, old_path: Option<String>, change, additions: u32, deletions: u32, binary: bool }  // camelCase
struct TaskDiffSummary { base_label: Option<String>, files: Vec<DiffFileEntry> }  // camelCase
```

### `native/src/lib.rs` — two commands (async, `spawn_blocking`)

Resolve the task → path under the db lock, drop the lock, then run git:

- `task_diff_summary(task_id) -> TaskDiffSummary`
- `task_diff_file(task_id, file) -> String`

Path resolution: worktree tasks use `worktree_path` and a `resolve_diff_base`
base; direct-edit tasks use `repo.path` with `base = None`. Two commands so the
file list loads instantly and patch bodies load lazily per file (a 2000-line
refactor diff stays cheap).

## Frontend

- **`src/types.ts`** — `DiffChangeKind`, `DiffFileEntry`, `TaskDiffSummary`.
- **`src/api.ts`** — `taskDiffSummary(taskId)`, `taskDiffFile(taskId, file)`, with
  browser-preview seeds and non-Tauri fallbacks.
- **`src/hooks/useTaskDiff.ts`** — owns data: loads the summary, lazy-loads and
  caches per-file patches, exposes `refresh()`, and re-fetches the summary on
  `session_idle` for this task (the agent finished a turn → diff changed). No
  refetch on raw `session_output`.
- **`src/components/TaskDiffView.tsx`** + **`src/styles/diff.css`** — presentational,
  props-driven (summary, loading, error, files cache, onSelectFile). Left file list
  (status glyph · path · `+a −d`) and a right unified-diff pane (master-detail,
  first file auto-selected). Line-based rendering: each patch line classed by its
  leading char (`+`/`-`/`@@`/meta/context); binary files show "Binary file" instead
  of a patch. States: Skeleton (loading), Alert (error), Empty ("No changes yet").
  Colors come from semantic status tokens only.
- **`src/components/TaskWorkspace.tsx`** — mounts `useTaskDiff` above the early
  return; a `ToggleGroup` segmented control on the stage header switches the stage
  body between `TerminalPane` and `TaskDiffView`, with a ⟳ refresh and the
  changed-file count badge. Switching to the Diff tab (or changing task while on it)
  triggers `refresh()`.

## Testing & seed

- **Rust** (`git_ops` tests, temp-repo pattern): working-tree changes with
  `base = None` (modified + untracked entries, counts); committed + uncommitted
  against an explicit base commit; `resolve_diff_base` via the existing
  clone+remote+branch fixture.
- **Frontend**: `TaskDiffView` rendering (file list, colored patch lines, empty
  state, selection), `useTaskDiff` refresh/lazy-load/idle-refresh, and the
  `TaskWorkspace` tab toggle.
- **`src/lib/browserSeed.ts`**: a sample summary + patch so the Diff tab renders in
  `pnpm dev`.

## Docs

Same change: new "Task Diff" section in `docs/features.md`, the two commands in
`docs/tracking-and-debugging.md`, and the command list in `CLAUDE.md`.
