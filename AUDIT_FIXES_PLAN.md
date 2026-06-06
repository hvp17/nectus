# Audit Fixes — Rolling Implementation Plan

Derived from the multi-agent audit (`/tmp/nectus_audit_report.md`). Items are removed as completed.
Verification gates: `pnpm test`, `pnpm build`, `cd native && cargo test`. TDD where logic-bearing.

---

## Phase 1 — High-impact correctness & safety ✅ COMPLETE

All Phase 1 items done (R1-R7, F1-F5). Verified: `pnpm test`, `tsc`, `cargo test`, `cargo clippy`.
Docs updated for the dirty-worktree delete confirmation.

---

## Phase 2 — Lock discipline & log tailing

- [x] **P2-R1** ✅ `create_task`/`list_tasks`/`delete_pr_review` async+spawn_blocking; `list_tasks` computes dirtiness off the DB lock. (`task_by_id`'s single dirty check left in place to preserve isDirty on single-task command returns.)
- [x] **P2-R2** ✅ Partial-trailing-line bug fixed via shared `watch_event_log` + pure `newly_complete_lines` (newline-terminated only). Codex/Claude watchers de-duplicated.
- [x] **P2-R3** ✅ Shared `pr_worktree::with_pr_worktree` scaffold; unique `nectus-pr-review-<pr>-<id>` branch/path (collision fix); `git_ops::delete_branch` on teardown (branch-leak fix). Docs updated.

**Phase 2 ✅ COMPLETE.**

---

## Phase 3 — Reuse consolidation

- [x] **P3-1** ✅ External-link helper: fixed `PrReviewDetail` dead "Open PR" link; routed `App.tsx`/`TerminalPane` through `openExternal`.
- [x] **P3-2** ✅ `git_output` consolidation + `git_output_allowing_codes`; `is_untracked`→Result (empty-diff bug); `validate_repo_path`/`is_dirty`/`untracked_patch` routed; lossy path fixed. (2 worktree-add sites left as raw Command — need OsStr-arg generalization; deferred.)
- [ ] **P3-3** `useTauriEvent<T>` hook; migrate `useTaskReviewLoop`/`usePrReviews`/`useTaskDiff`/`JiraWorkItemDialog`. *(pure reuse — deferred)*
- [ ] **P3-4** `useGuardedAction` adoption: `addProject`, `JiraConnectionCard`, `useJira` handlers. *(pure reuse — deferred)*
- [x] **P3-5** ✅ `usePrReviews` reuses `lib/listState` (`upsertById`/new `upsertNewestById`); prunes `runsByReview` on delete (memory-growth bug).
- [ ] **P3-6** Rust helpers: `run_cli`, `async fn blocking`, `enum_as_str!` macro, schema `add_column_if_missing` collapse. *(pure reuse — partial below)*
- [ ] **P3-7** Shared FE helpers: `isCliConnected`/`cliConnectionState`/`ConnectionBadge`/`deriveAttentionPreview`; hoist `REVIEW_TERMINAL_STATUSES`. *(pure reuse — deferred)*

---

## Phase 4 — Architecture & improvements

- [ ] **P4-1** `useJiraBoardView` extraction from `useApp`.
- [ ] **P4-2** `useSessionEvents` single-owner of `session_exited`; `TerminalPane.onSessionExit` UI-only.
- [ ] **P4-3** Pull JIRA/PR-review domain logic out of `lib.rs` (`jira_rest::transition_to_status`, creds helper, reviewer-id/mode helper).
- [ ] **P4-4** Module splits: `db/mod.rs` (tasks/settings/sessions), `git_ops.rs` (diff vs worktree), `pr_verdict.rs`.
- [ ] **P4-5** Improvements batch: Mission Control ticker+memoization, `deriveColumns` memo, clipboard wrapper, `accountId` fallback, `RunningSession` store `AgentKind`, watcher O(n) re-read (folded into P2-R2), misc doc/naming.

---

## Lower-priority bug tail
- [x] ✅ `build_board_jql` backslash-escape (`jql_quote`). `jira.rs`.
- [x] ✅ `is_untracked`→Result empty-diff bug (in P3-2). `git_ops.rs`.
- [x] ✅ `jira_transition_work_item` panic now degrades to acli (JoinError folded into fallback). `lib.rs`.
- [x] ✅ `record_review_run` + consensus-rows transactions. `review_loops.rs`, `pr_reviews.rs`.
- [x] ✅ dropped-file path control-char strip. `TerminalPane.tsx`.
- [x] ✅ `openTask` nonexistent-id guard. `App.tsx`.
- [x] ✅ `JiraStatusCategory::from_token` whole-word match (no `Abandoned`→Done). `models/jira.rs`.
- [x] ✅ `PRAGMA foreign_keys` enforced per-connection at open. `db/mod.rs`.
- [x] ✅ `api.githubPullRequestStatus` non-Tauri guard. `api.ts`.

### Deferred (deliberate — low severity / pure-reuse / high-churn, low-risk to leave)
- review-loop `FeedbackSent`-before-delivery ordering — low, self-corrects to Error; a safe fix needs splitting `record_review_run` (risks losing the run record on send failure in a core feature). Atomicity half done above.
- `resolve_diff_base` non-origin remote (`origin/HEAD` only) — low; degrades to HEAD diff.
- 2 worktree-add git sites not routed through `git_output` — need OsStr-arg generalization of the helper.
- FE micro-races: double board fetch on first project select, double diff fetch on tab+task switch, stale reviewer selections in `ReviewsPage`/`TaskWorkspace` — low.
- **P3-3** `useTauriEvent` hook, **P3-4** `useGuardedAction` adoption, **P3-6** `run_cli`/`async fn blocking`/`enum_as_str!`/`add_column_if_missing`, **P3-7** shared FE connection helpers — pure reuse, no behavior change.
- **Phase 4** architecture: `useJiraBoardView` extraction, single-owner `session_exited` (the duplicate clear is idempotent — harmless), pull domain logic out of `lib.rs`, `db`/`git_ops` module splits, `pr_verdict.rs`.
- **P4-5** improvement polish: Mission Control ticker/memoization, `deriveColumns` memo, clipboard wrapper, `accountId` fallback, `RunningSession` store `AgentKind`, watcher byte-offset O(n) read.
