# Inline Review Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild task reviews as a Cursor-Bugbot-style inline subagent: a `/review` command in the task chat launches the configured reviewer as its own ACP session, rendered inline in the transcript as a collapsible block with live tool activity + a verdict chip.

**Architecture:** A new `ChatPart::Subagent` variant carries the reviewer's nested transcript. A new `run_inline_review` driver runs the reviewer's ACP turn with the chat path's `TurnAccumulator` (capturing tool calls + reasoning, not just prose) and emits `session_chat` events containing a `Subagent` part on the task's chat session — reusing the existing live-render + persist path. `/review` is an app-intercepted composer command. The separate task Review pane retires; the `review_loop` row stays as reviewer-config + session + run storage.

**Tech Stack:** Rust, `agent-client-protocol` 0.14, Tauri, `parking_lot`, `serde`; React + TypeScript, TanStack Query, the existing `renderChatParts` + `groupToolParts` chat renderer.

**Spec:** `docs/superpowers/specs/2026-06-17-inline-review-subagents-design.md`

**Builds on:** the merged ACP review driver (`native/src/sessions/review_runtime.rs::run_review`, `verdict.rs::parse_verdict_block`, `acp.rs::TurnAccumulator`) and the chat path (`acp_manager.rs` `session_chat`/`append_chat_message`).

**Reference patterns to mirror (read these; don't reinvent):**
- `native/src/sessions/review_runtime.rs::run_review` — ACP launch, `initialize`, `session/new`/`session/load` resume, single prompt, auto-approve permission handler, verdict self-repair. The inline driver shares all of this; only the per-update handling + result emission differ.
- `native/src/sessions/acp_manager.rs::run_connection` (notification handler + `persist_and_emit`, ~lines 437–812) — how a `TurnAccumulator` snapshot becomes a `session_chat` `ChatMessageEvent` and is persisted via `append_chat_message`.
- `native/src/sessions/review_loop.rs` — `build_review_prompt` / `build_review_continuation_prompt` / `verdict_from_token`; reused by the inline driver.

**Testing reality:** live ACP I/O is not unit-tested (mirrors `acp_manager.rs`); validate the live turn in `pnpm desktop:dev`. Unit-test only pure logic (type round-trips, verdict→label mapping, `/review` parsing, the Subagent message builder, group pass-through). All Rust commands run from `native/`. Do NOT run repo-wide `cargo fmt`/bare `rustfmt` (rewrites vendored `sessions/codex.rs`, wrong edition); format only changed files with `rustfmt --edition 2021 <file>`.

---

## File Structure

- **Modify** `native/src/models/chat.rs` — add `ChatPart::Subagent { name, agent_kind, parts, status, verdict }`, `SubagentStatus`, `ReviewVerdictLabel`.
- **Modify** `src/types.ts` — mirror the above onto the `ChatPart` union.
- **Modify** `native/src/sessions/review_runtime.rs` — add `run_inline_review` (inline ACP turn + Subagent emission) next to `run_review`; extract the shared launch/initialize/session/permission/self-repair scaffolding so the two don't duplicate it.
- **Modify** `native/src/sessions/review_loop.rs` — expose `build_review_prompt`/`build_review_continuation_prompt`/`verdict_from_token` for reuse; remove the now-unused `spawn_task_review`/`run_review_round` (pane path) once the inline path replaces it.
- **Modify** `native/src/lib.rs` — add the `acp_start_review` command; register it; remove `run_pair_review` registration (replaced).
- **Modify** `src/api.ts` — add `acpStartReview`.
- **Modify** `src/components/chat/ChatPane.tsx` — intercept `/review` in `send`; surface `/review` in the command menu.
- **Modify** `src/lib/chat/renderChatParts.tsx` — render the `subagent` part (collapsible card reusing `groupToolParts` + `renderChatPart` for nested parts).
- **Modify** `src/components/taskWorkspace/TaskWorkspaceStage.tsx` + `src/components/TaskWorkspace.tsx` — drop the `Review` tab for tasks (stage becomes `Chat | Diff`); the facts-rail review card shows the last verdict + a "configure reviewer" affordance.
- **Modify** docs.

---

## Task 1: `ChatPart::Subagent` wire types

**Files:**
- Modify: `native/src/models/chat.rs` (the `ChatPart` enum, ~line 111)
- Modify: `src/types.ts` (the `ChatPart` union, ~line 406)

- [ ] **Step 1: Write the failing Rust round-trip test**

Add to the `tests` module in `native/src/models/chat.rs` (create one if absent, `#[cfg(test)] mod tests { use super::*; ... }`):

```rust
    #[test]
    fn subagent_part_round_trips_with_nested_parts_and_verdict() {
        let part = ChatPart::Subagent {
            name: "Reviewer".to_string(),
            agent_kind: AgentKind::Claude,
            parts: vec![ChatPart::Text { text: "Looks good".to_string() }],
            status: SubagentStatus::Completed,
            verdict: Some(ReviewVerdictLabel::Clean),
        };
        let json = serde_json::to_string(&part).unwrap();
        assert!(json.contains("\"type\":\"subagent\""));
        assert!(json.contains("\"agentKind\":\"claude\""));
        assert!(json.contains("\"status\":\"completed\""));
        assert!(json.contains("\"verdict\":\"clean\""));
        let back: ChatPart = serde_json::from_str(&json).unwrap();
        assert_eq!(back, part);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd native && cargo test models::chat::tests::subagent_part_round_trips`
Expected: FAIL — `ChatPart::Subagent`, `SubagentStatus`, `ReviewVerdictLabel` not found.

- [ ] **Step 3: Add the types**

In `native/src/models/chat.rs`, ensure `AgentKind` is imported (`use crate::models::AgentKind;` if not already in scope), then add the variant to `ChatPart` (after `Plan`):

```rust
    /// A nested subagent run (e.g. a `/review` reviewer) rendered as a collapsible
    /// block in the host transcript. `parts` is the subagent's own normalized
    /// transcript (reused by the same renderer). `verdict` is set once resolved.
    Subagent {
        name: String,
        agent_kind: AgentKind,
        parts: Vec<ChatPart>,
        status: SubagentStatus,
        verdict: Option<ReviewVerdictLabel>,
    },
```

Add the two enums (near `ChatPart`):

```rust
/// Lifecycle of a nested subagent block.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
}

/// The wire form of a review verdict for the subagent chip (the serializable
/// projection of `sessions::verdict::VerdictToken`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewVerdictLabel {
    Clean,
    Blockers,
    Feedback,
}
```

(`ChatPart` already derives `Serialize, Deserialize, PartialEq` with `#[serde(tag="type", rename_all="snake_case", rename_all_fields="camelCase")]`, so `subagent`/`agentKind` casing is automatic. Confirm `AgentKind` serializes snake_case — it's used elsewhere in models; if its rename differs, the test's `"claude"` assertion will catch it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd native && cargo test models::chat::tests::subagent_part_round_trips`
Expected: PASS.

- [ ] **Step 5: Mirror in `src/types.ts`**

Add to the `ChatPart` union (after the `plan` member, ~line 421):

```ts
  | {
      type: "subagent";
      name: string;
      agentKind: AgentKind;
      parts: ChatPart[];
      status: SubagentStatus;
      verdict?: ReviewVerdictLabel | null;
    };
```

And add the supporting types near `ChatPart`:

```ts
export type SubagentStatus = "running" | "completed" | "failed";
export type ReviewVerdictLabel = "clean" | "blockers" | "feedback";
```

Confirm `AgentKind` is already exported from `src/types.ts` (it is — agent profiles use it); if not, add it.

- [ ] **Step 6: Verify frontend types compile**

Run: `pnpm build` (or `pnpm exec tsc --noEmit`)
Expected: PASS — the new union member is handled by `renderChatPart`'s `default` until Task 5 adds its case.

- [ ] **Step 7: Commit**

```bash
git add native/src/models/chat.rs src/types.ts
git commit -m "feat(chat): add ChatPart::Subagent wire type"
```
End the commit body with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 2: Inline review driver (`run_inline_review`)

**Files:**
- Modify: `native/src/sessions/review_runtime.rs`
- Modify: `native/src/sessions/review_loop.rs` (expose prompt builders + `verdict_from_token` as `pub(super)`)

This is the I/O-heavy task. Mirror `run_review` for the ACP scaffolding; the difference is: accumulate with `TurnAccumulator` (full parts), and on each update emit a `session_chat` `ChatMessageEvent` whose message is `[ChatPart::Subagent{…}]` on the **chat** session.

- [ ] **Step 1: Add the verdict→label mapper + its test (TDD)**

In `native/src/sessions/review_runtime.rs`, add:

```rust
use crate::models::ReviewVerdictLabel;

/// Project the internal verdict token to its serializable wire label for the
/// subagent chip.
pub(super) fn verdict_label(token: Option<super::verdict::VerdictToken>) -> Option<ReviewVerdictLabel> {
    use super::verdict::VerdictToken;
    match token {
        Some(VerdictToken::Clean) => Some(ReviewVerdictLabel::Clean),
        Some(VerdictToken::Blockers) => Some(ReviewVerdictLabel::Blockers),
        Some(VerdictToken::Feedback) => Some(ReviewVerdictLabel::Feedback),
        None => None,
    }
}
```

Add to the `tests` module:

```rust
    #[test]
    fn verdict_label_projects_each_token() {
        use super::super::verdict::VerdictToken;
        assert_eq!(verdict_label(Some(VerdictToken::Clean)), Some(crate::models::ReviewVerdictLabel::Clean));
        assert_eq!(verdict_label(Some(VerdictToken::Blockers)), Some(crate::models::ReviewVerdictLabel::Blockers));
        assert_eq!(verdict_label(Some(VerdictToken::Feedback)), Some(crate::models::ReviewVerdictLabel::Feedback));
        assert_eq!(verdict_label(None), None);
    }
```

Run `cd native && cargo test sessions::review_runtime::tests::verdict_label` → fails, then implement (above) → passes.

- [ ] **Step 2: Add the Subagent message builder + its test (TDD)**

Add a pure helper that wraps accumulator parts into a Subagent `ChatMessage` (so the wrapping is testable without ACP I/O):

```rust
use crate::models::{ChatMessage, ChatPart, ChatRole, SubagentStatus};

/// Build the host-transcript message that carries the reviewer's nested run.
pub(super) fn subagent_message(
    message_id: &str,
    created_at: &str,
    reviewer: &AgentProfile,
    nested_parts: Vec<ChatPart>,
    status: SubagentStatus,
    verdict: Option<ReviewVerdictLabel>,
    completed_at: Option<String>,
) -> ChatMessage {
    ChatMessage {
        id: message_id.to_string(),
        role: ChatRole::Agent,
        parts: vec![ChatPart::Subagent {
            name: reviewer.name.clone(),
            agent_kind: reviewer.agent_kind,
            parts: nested_parts,
            status,
            verdict,
        }],
        created_at: created_at.to_string(),
        completed_at,
    }
}
```

Test:

```rust
    #[test]
    fn subagent_message_wraps_nested_parts() {
        let reviewer = test_reviewer(); // a small AgentProfile fixture (Claude); add if absent
        let msg = subagent_message(
            "rev-1", "now", &reviewer,
            vec![ChatPart::Text { text: "ok".into() }],
            SubagentStatus::Running, None, None,
        );
        assert_eq!(msg.parts.len(), 1);
        match &msg.parts[0] {
            ChatPart::Subagent { name, parts, status, verdict, .. } => {
                assert_eq!(name, "Claude Reviewer");
                assert_eq!(parts.len(), 1);
                assert_eq!(*status, SubagentStatus::Running);
                assert!(verdict.is_none());
            }
            _ => panic!("expected subagent part"),
        }
    }
```

(Add a `fn test_reviewer() -> AgentProfile` fixture named "Claude Reviewer" in the test module if one isn't already available.) Run the test red→green.

- [ ] **Step 3: Expose the reused prompt builders**

In `native/src/sessions/review_loop.rs`, change `build_review_prompt`, `build_review_continuation_prompt`, and `verdict_from_token` from `fn`/`pub(super) fn` to `pub(super) fn` (they're already `pub(super)`; confirm). The inline driver imports them: `use super::review_loop::{build_review_prompt, build_review_continuation_prompt};`. If a `focus` is provided, append it to the prompt as a trailing paragraph: `format!("{prompt}\n\nFocus this review on: {focus}")`.

- [ ] **Step 4: Implement `run_inline_review` (live; mirror `run_review`)**

Add `run_inline_review` to `review_runtime.rs`. Signature:

```rust
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_inline_review(
    app: AppHandle,
    db: Arc<DbMutex<Database>>,
    chat_session_id: String,
    task_id: i64,
    agent_profile_id: Option<i64>,
    reviewer: AgentProfile,
    cwd: PathBuf,
    prompt: String,
    resume: Option<String>,
    message_id: String,
) -> Result<ReviewRun, String>
```

Behavior (mirror `run_review`'s launch/initialize/session/permission/self-repair exactly — extract that scaffolding into a shared private helper so both functions share it; the difference is the notification handler + finalize):
- Notification handler: fold each `SessionUpdate` into a `TurnAccumulator` (shared behind `Arc<tokio::sync::Mutex<…>>`); after each fold, build `subagent_message(&message_id, …, &reviewer, acc.snapshot(None).parts, SubagentStatus::Running, None, None)` and emit it via `app.emit("session_chat", ChatMessageEvent { session_id: chat_session_id.clone(), task_id, agent_profile_id, message, done: false })`. (Mirror `acp_manager.rs`'s emit; do NOT hold the accumulator lock across the `.await`-free `emit` — emit is sync, fine.)
- Permission handler: identical auto-approve as `run_review`.
- After the prompt turn settles: take the accumulator snapshot; parse the verdict from its text parts via `parse_verdict_block` over the concatenated `Text` parts; strip the verdict block from the displayed text part; run the one-shot self-repair (same as `run_review`, but accumulate the repair turn silently — do NOT emit/keep it).
- Finalize: build the final `subagent_message(..., status: Completed (or Failed on error), verdict: verdict_label(token), completed_at: Some(now()))`, **persist** it with `db.lock().append_chat_message(&chat_session_id, task_id, &message)?` and emit one last `session_chat` with `done: true`. Return `ReviewRun { text, verdict: token, session_id }`.
- On launch/ACP error: build a `Failed` subagent message (nested parts = a single `ChatPart::Text { text: error }`), persist + emit it, and return `Err`.

Custom-agent rejection and `loadSession`-gated resume are inherited from the shared scaffolding.

- [ ] **Step 5: Verify build + unit tests**

Run: `cd native && cargo build && cargo test sessions::review_runtime && cargo clippy --all-targets -- -D warnings`
Expected: clean build, the `verdict_label` + `subagent_message` tests pass, no warnings. (The live turn is validated in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add native/src/sessions/review_runtime.rs native/src/sessions/review_loop.rs
git commit -m "feat(reviews): inline review driver emitting a Subagent chat message"
```
(+ trailer.)

---

## Task 3: `acp_start_review` command + API binding

**Files:**
- Modify: `native/src/lib.rs`
- Modify: `src/api.ts`

- [ ] **Step 1: Add the command**

In `native/src/lib.rs`, add (model it on `run_pair_review` for config resolution + `acp_send_prompt` for the async/spawn shape):

```rust
#[tauri::command]
async fn acp_start_review(
    task_id: i64,
    chat_session_id: String,
    focus: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (reviewer, cwd, resume, agent_profile_id) = {
        let db = state.db.lock();
        let review_loop = db
            .review_loop_by_task_id(task_id)?
            .ok_or_else(|| "Configure a reviewer for this task before running /review".to_string())?;
        let reviewer = db
            .agent_profile_by_id(review_loop.reviewer_profile_id)?
            .ok_or_else(|| "Reviewer profile not found".to_string())?;
        let task = db.task_by_id(task_id)?.ok_or_else(|| "Task not found".to_string())?;
        let cwd = task
            .worktree_path
            .or_else(|| task.task_repos.first().and_then(|r| r.worktree_path.clone()))
            .or_else(|| db.repo_by_id(task.repo_id).ok().flatten().map(|r| r.path))
            .ok_or_else(|| "Task has no repository path to review".to_string())?;
        let resume = db.review_loop_session_id(task_id)?;
        (reviewer, cwd, resume, Some(review_loop.reviewer_profile_id))
    };
    sessions::spawn_inline_review(
        app, state.db.clone(), chat_session_id, task_id, agent_profile_id, reviewer,
        cwd.into(), resume, focus,
    );
    Ok(())
}
```

Add a `pub(crate) fn spawn_inline_review(...)` in `native/src/sessions/mod.rs` (or `review_runtime.rs`, re-exported from `mod.rs`) that:
- chooses `build_review_prompt` vs `build_review_continuation_prompt` based on `resume.is_some()`, appends `focus`, mints a `message_id` (`format!("review-{}", uuid::Uuid::new_v4())`),
- `tauri::async_runtime::spawn`s `run_inline_review(...)`, and on `Ok`/`Err`: records a run via `db.record_review_run(ReviewRunInput { task_id, reviewer_profile_id, verdict, prompt, output, error })` and persists the resolved `session_id` (`set_review_loop_session_id`) when it was a fresh run. (Reuse the recording logic from the old `review_loop.rs::run_review_round`, now removed there.)

Register `acp_start_review` in `generate_handler!` and remove `run_pair_review` (replaced). Keep `stop_pair_loop`/`get_task_review_loop`/`list_task_review_runs` (reviewer config + history).

- [ ] **Step 2: Build**

Run: `cd native && cargo build && cargo clippy --all-targets -- -D warnings`
Expected: clean. If removing `run_pair_review` orphans `spawn_task_review`/`run_review_round` in `review_loop.rs`, remove those too (their prompt builders + `verdict_from_token` stay, now used by the inline path).

- [ ] **Step 3: Add the API binding**

In `src/api.ts`, add (mirror `acpSendPrompt`):

```ts
  async acpStartReview(taskId: number, chatSessionId: string, focus?: string): Promise<void> {
    return invoke("acp_start_review", { taskId, chatSessionId, focus: focus ?? null });
  },
```

Remove `runPairReview` if nothing else calls it (grep first; the Task 6 frontend change removes its caller).

- [ ] **Step 4: Commit**

```bash
git add native/src/lib.rs native/src/sessions/mod.rs native/src/sessions/review_runtime.rs native/src/sessions/review_loop.rs src/api.ts
git commit -m "feat(reviews): acp_start_review command for on-demand inline reviews"
```
(+ trailer.) Run `cd native && cargo test` to confirm the suite is green after the review_loop removals.

---

## Task 4: `/review` composer interception

**Files:**
- Create: `src/lib/chat/reviewCommand.ts` (pure parser)
- Modify: `src/components/chat/ChatPane.tsx`

- [ ] **Step 1: Write the parser test (TDD)**

Create `src/lib/chat/reviewCommand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReviewCommand } from "./reviewCommand";

describe("parseReviewCommand", () => {
  it("matches bare /review with no focus", () => {
    expect(parseReviewCommand("/review")).toEqual({ isReview: true, focus: undefined });
    expect(parseReviewCommand("  /review  ")).toEqual({ isReview: true, focus: undefined });
  });
  it("captures a focus argument", () => {
    expect(parseReviewCommand("/review check the locking")).toEqual({
      isReview: true,
      focus: "check the locking",
    });
  });
  it("does not match /review embedded mid-message", () => {
    expect(parseReviewCommand("please /review this")).toEqual({ isReview: false });
    expect(parseReviewCommand("/reviewer")).toEqual({ isReview: false });
  });
});
```

Run `pnpm exec vitest run src/lib/chat/reviewCommand.test.ts` → fails.

- [ ] **Step 2: Implement the parser**

Create `src/lib/chat/reviewCommand.ts`:

```ts
/** Parse a composer message for the reserved `/review [focus]` app command. */
export function parseReviewCommand(text: string):
  | { isReview: true; focus: string | undefined }
  | { isReview: false } {
  const trimmed = text.trim();
  if (trimmed !== "/review" && !trimmed.startsWith("/review ")) {
    return { isReview: false };
  }
  const focus = trimmed.slice("/review".length).trim();
  return { isReview: true, focus: focus.length > 0 ? focus : undefined };
}
```

Run the test → passes.

- [ ] **Step 3: Intercept in the composer**

In `src/components/chat/ChatPane.tsx`, at the top of the `send` callback (before `setBusy(true)`), add the interception:

```tsx
      const review = parseReviewCommand(text);
      if (review.isReview) {
        if (reviewerConfigured !== true) {
          useAppStore.getState().setMessage("Configure a reviewer for this task to use /review.");
          return;
        }
        setBusy(true);
        try {
          let id = activeSessionId;
          if (!id) id = await startChatRef();          // ensure a chat session exists to render into
          await api.acpStartReview(taskId, id, review.focus);
        } catch (error) {
          useAppStore.getState().setMessage(String(error));
        } finally {
          setBusy(false);
        }
        return;
      }
```

Notes for the implementer:
- `import { parseReviewCommand } from "@/lib/chat/reviewCommand";`.
- `reviewerConfigured` is whether the task has a configured reviewer — derive it from the task's review-loop query (the same data the facts-rail review card uses; add a small prop/selector if not already in `ChatPane`). If wiring that into `ChatPane` is heavy, instead let the backend reject (it already returns the "Configure a reviewer…" error) and surface that error — but prefer the local guard to avoid a round-trip.
- Reuse the existing `startChat` logic for "ensure a session exists" — factor the inner `startChat` closure so the review path can call it (the snippet calls `startChatRef()`; name it however fits the existing code). `acpStartReview` needs a real `chat_session_id`.

- [ ] **Step 4: Surface `/review` in the command menu**

In `ChatCommandMenu` usage (ChatPane line ~300), prepend a Nectus app command so `/review` is discoverable. Pass an extra prop (e.g. `appCommands={[{ name: "review", description: "Review this task's changes (inline)" }]}`) and have `ChatCommandMenu` render an "App" group above the agent's `availableCommands`; selecting it inserts `/review ` into the composer (same insert behavior as agent commands). Keep the agent commands unchanged.

- [ ] **Step 5: Verify + commit**

Run: `pnpm exec vitest run src/lib/chat/reviewCommand.test.ts && pnpm build`
Expected: PASS, clean build.

```bash
git add src/lib/chat/reviewCommand.ts src/lib/chat/reviewCommand.test.ts src/components/chat/ChatPane.tsx src/components/chat/ChatCommandMenu.tsx
git commit -m "feat(chat): intercept /review in the composer to launch an inline review"
```
(+ trailer.)

---

## Task 5: Render the Subagent block

**Files:**
- Modify: `src/lib/chat/renderChatParts.tsx`
- Modify: `src/lib/chat/groupToolParts.ts` (test only — add a pass-through test)

- [ ] **Step 1: Add a group pass-through test (TDD)**

In a `groupToolParts` test file (create `src/lib/chat/groupToolParts.test.ts` if absent, else extend it):

```ts
import { describe, expect, it } from "vitest";
import { groupToolParts } from "./groupToolParts";
import type { ChatPart } from "@/types";

describe("groupToolParts + subagent", () => {
  it("passes a subagent part through as a single render item", () => {
    const sub: ChatPart = {
      type: "subagent", name: "Reviewer", agentKind: "claude", parts: [], status: "running",
    };
    const items = groupToolParts([sub]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("single");
  });
});
```

Run it → it should already PASS (subagent is non-groupable). This pins the behavior so a future `GROUPABLE_KINDS` change can't accidentally fold it.

- [ ] **Step 2: Render the subagent case**

In `src/lib/chat/renderChatParts.tsx`, add a `case "subagent":` to `renderChatPart`'s switch (before `default`). It renders a collapsible card whose body reuses the existing renderers over the nested parts:

```tsx
    case "subagent": {
      const verdictChip = part.verdict ? (
        <Badge
          className={cn(
            "h-5 px-1.5 text-[10px] capitalize",
            part.verdict === "clean" && "text-status-success",
            part.verdict === "blockers" && "text-destructive",
            part.verdict === "feedback" && "text-status-warning",
          )}
          data-testid="subagent-verdict"
          variant="outline"
        >
          {part.verdict}
        </Badge>
      ) : null;
      const running = part.status === "running";
      return (
        <Tool key={partKey} data-testid="chat-subagent" defaultOpen={running}>
          <ToolHeader
            compact
            glyph={toolGlyph("execute", running ? "running" : "completed")}
            hideStatusBadge
            state={mapToolState(running ? "running" : "completed")}
            title={part.name}
            toolName="subagent"
            trailing={part.status === "failed"
              ? <Badge className="h-5 px-1.5 text-[10px] text-destructive" variant="outline">Failed</Badge>
              : verdictChip}
            type="dynamic-tool"
          />
          <ToolContent>
            {groupToolParts(part.parts).map((item) =>
              item.kind === "tool-group"
                ? renderToolGroup({ parts: item.parts, handlers, groupKey: `${partKey}-${item.key}` })
                : renderChatPart({ part: item.part, handlers, isStreaming: running && item.part.type === "text", partKey: `${partKey}-${item.key}` }),
            )}
          </ToolContent>
        </Tool>
      );
    }
```

(Reuses `Tool`/`ToolHeader`/`ToolContent`, `toolGlyph`, `mapToolState`, `groupToolParts`, `renderToolGroup`, and recurses into `renderChatPart` — all already in this file. `Badge` and `cn` are already imported. The block defaults open while running, collapses when done — Codex/Cursor style.)

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec vitest run src/lib/chat/groupToolParts.test.ts && pnpm build`
Expected: PASS, clean build (the `default` branch no longer the only handler for subagent; exhaustiveness fine).

```bash
git add src/lib/chat/renderChatParts.tsx src/lib/chat/groupToolParts.test.ts
git commit -m "feat(chat): render the inline review Subagent block"
```
(+ trailer.)

---

## Task 6: Retire the task Review pane

**Files:**
- Modify: `src/components/TaskWorkspace.tsx`, `src/components/taskWorkspace/TaskWorkspaceStage.tsx`
- Modify: `src/components/taskWorkspace/TaskWorkspaceFactsRail.tsx` (review card)
- Modify: `src/hooks/useTaskReviewLoop.ts` (drop the live `review_output` pane stream; keep reviewer config + run history)

- [ ] **Step 1: Drop the Review tab**

In `TaskWorkspaceStage.tsx`, remove the `Review` entry from the `Chat | Diff | Review` toggle and the lazy `ReviewTerminalPane` import/branch for tasks (the toggle becomes `Chat | Diff`). In `TaskWorkspace.tsx`, remove the "starting review auto-selects Review" logic and any `review`-tab state. (`ReviewTerminalPane.tsx` stays — the external PR-reviews view still uses it.)

- [ ] **Step 2: Repoint the facts-rail review card**

In `TaskWorkspaceFactsRail.tsx`, the review card now shows: the **configured reviewer** (with a control to set/change it — the existing reviewer-select that writes `review_loop.reviewer_profile_id`), and the **last verdict** from the most recent review run (`list_task_review_runs`). Remove the "Watch live / View output" button that opened the Review tab; instead a short hint: "Run `/review` in chat to review." Keep using the review-loop query for reviewer config + the runs query for the last verdict.

- [ ] **Step 3: Trim `useTaskReviewLoop`**

In `useTaskReviewLoop.ts`, remove the `review_output` live-stream subscription and the Review-pane state (no pane to feed now). Keep: the reviewer-config read/write, the review-runs query (for the last verdict), and any `review_loop_updated` handling still needed by the facts rail. The inline review's live output now flows through the chat `session_chat` path (no special hook).

- [ ] **Step 4: Verify + commit**

Run: `pnpm test` (frontend suite) and `pnpm build`.
Expected: PASS. Update/remove any test that asserted the Review tab or the live pane for tasks; add/adjust a test that the task stage shows only `Chat | Diff`.

```bash
git add src/components/TaskWorkspace.tsx src/components/taskWorkspace/ src/hooks/useTaskReviewLoop.ts
git commit -m "refactor(reviews): retire the task Review pane for the inline subagent"
```
(+ trailer.)

---

## Task 7: Documentation

**Files:** `docs/features.md`, `docs/architecture.md`, `CLAUDE.md` (= `AGENTS.md`), `docs/tracking-and-debugging.md`

- [ ] **Step 1: `docs/features.md`** — task reviews are now an on-demand inline `/review` subagent in the chat (Bugbot-style): a collapsible block with live tool activity + a verdict chip; re-running does a delta review; the separate Review tab is gone for tasks. External PR reviews unchanged. The reviewer is the task's configured reviewer profile; `/review <focus>` steers it.

- [ ] **Step 2: `CLAUDE.md`/`AGENTS.md`** — backend map: `review_runtime.rs` now also hosts `run_inline_review` (emits a `ChatPart::Subagent` message on the chat session); `models/chat.rs` has the `Subagent` part. Frontend map: `renderChatParts.tsx` renders the subagent block; `src/lib/chat/reviewCommand.ts` parses `/review`; the task stage is `Chat | Diff`. Add `acp_start_review` to the command reference (point to `docs/tracking-and-debugging.md`).

- [ ] **Step 3: `docs/tracking-and-debugging.md`** — add the `acp_start_review` command; note the inline review streams over the existing `session_chat` event (a `Subagent` part), not the `review_output` pane stream (which is now PR-reviews-only); the per-task resumable reviewer session id + review-run recording are unchanged.

- [ ] **Step 4: `docs/architecture.md`** — "where does X live": task review = inline `/review` subagent in chat (`run_inline_review` → `Subagent` part), pane retired for tasks.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: inline review subagents"
```
(+ trailer.)

---

## Task 8: Verification

- [ ] **Step 1: Full static verification**

Run: `cd native && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` then `cd .. && pnpm verify`. All green. (Format only changed files if `fmt --check` flags yours; don't touch vendored files.)

- [ ] **Step 2: Manual `desktop:dev` validation** (the live ACP turn is not unit-tested)

In the running app, on a task with a worktree + a configured reviewer:
1. Type `/review` in the chat → a "Reviewer" subagent block appears inline, **streaming live tool activity** (greps/reads) + reasoning, then resolves to a **verdict chip** and collapses.
2. `/review <focus>` → the focus visibly steers the review.
3. Make a change, re-run `/review` → it **resumes** (delta review) when the agent supports `loadSession`; a new block appends.
4. No configured reviewer → inline guidance, no block.
5. A launch error (e.g. Custom reviewer) → the block renders a **Failed** state with the error.
6. The block persists across a chat reload (it's a chat message).

- [ ] **Step 3: Final branch review**

Dispatch a code reviewer over `git diff main...HEAD` focused on: the `run_inline_review` ↔ `run_review` shared-scaffolding factoring (no large duplication; no lock held across `.await`), the Subagent emit/persist ordering, and that the task review-config + run history still work after the pane removal.

---

## Self-Review (plan author)

**Spec coverage:** `/review` interception → Task 4. Reviewer = configured profile + optional focus → Tasks 3, 4. Separate reviewer ACP session surfaced inline (full tool activity via `TurnAccumulator`) → Task 2. `ChatPart::Subagent` + rendering → Tasks 1, 5. On-demand + resumable + run recording → Tasks 2, 3. Verdict chip → Tasks 1, 2, 5. Retire task Review pane → Task 6. Error states → Tasks 2, 4, 5. Docs → Task 7. Out-of-scope model B untouched. All spec sections map to a task.

**Placeholder scan:** No TBD/TODO. The one judgment call left to the implementer (local `reviewerConfigured` guard vs. backend-only rejection) is stated with a concrete default. The shared-scaffolding factoring in Task 2 is described with its exact difference points rather than left vague.

**Type consistency:** `ChatPart::Subagent { name, agent_kind, parts, status, verdict }` / TS `{ type:"subagent", name, agentKind, parts, status, verdict }`; `SubagentStatus` (`Running|Completed|Failed` ↔ `running|completed|failed`); `ReviewVerdictLabel` (`Clean|Blockers|Feedback` ↔ `clean|blockers|feedback`); `run_inline_review(...) -> Result<ReviewRun, String>`; `subagent_message(...)`, `verdict_label(...)`, `parseReviewCommand(...)`, `acpStartReview(taskId, chatSessionId, focus?)`, `acp_start_review` — names consistent across tasks. `ReviewRun`/`VerdictToken`/`verdict_from_token`/`parse_verdict_block` reused from the merged #115 code.
</content>
