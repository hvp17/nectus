# Inline Review Subagents — Design

**Status:** Approved for planning (2026-06-17)
**Builds on:** PR #115 (merged to `main` as `a06fe95`) — the headless ACP review driver `review_runtime.rs::run_review`. This branch is rebased on that `main`.
**Owner:** chat + reviewer surfaces (`native/src/sessions/`, `src/components/chat/`)

## Summary

Rebuild the **task review** experience as a Cursor-Bugbot-style **inline subagent**: a `/review` slash command in the task's chat launches the configured reviewer as its own ACP session, and the reviewer's live activity — reasoning, tool calls, the final review, and a verdict chip — renders **inline in the chat transcript** as a collapsible "subagent" block, instead of the separate read-only Review pane. Reviews become **on-demand** (each `/review` is one block; re-running resumes the reviewer session for a delta review), retiring the automatic loop-status machine for tasks. External PR reviews are unchanged.

This is **model A** from brainstorming (the reviewer is its own agent, rendered inline) — not the host agent spawning its own Task subagents (model B), which remains future work.

## Goals

- `/review` in a task's chat runs the configured reviewer with zero friction; `/review <focus>` steers it.
- The reviewer's turn renders inline as a collapsible block showing **live tool activity** (greps/reads/edits), reasoning, the review prose, and a verdict chip — reusing the existing compact tool-row rendering.
- On-demand, resumable: each invocation appends a block; re-running does a delta review against the prior reviewer session.
- Reuse the chat machinery (`TurnAccumulator`, `session_chat` events, `groupToolParts`, tool rows) rather than building a parallel rendering path.

## Non-Goals

- **No model B.** The host chat agent does not spawn the reviewer; we don't render ACP `subagent/create`/`subagent/sendMessage` from the host agent. (Future work.)
- **No change to external PR reviews.** Single + consensus PR reviews keep their dedicated view and `ReviewTerminalPane`. They may adopt the inline block rendering later; out of scope here.
- **No automatic re-review loop** for tasks. Reviews are user-triggered.
- **No reviewer-agent picker modal.** The reviewer is the task's configured reviewer profile; switching it is a setting, not a per-invocation modal.

## Background

PR #115 made reviews headless ACP sessions: `review_runtime.rs::run_review` drives one ACP turn, **accumulates only the agent's message text** (for the read-only `ReviewTerminalPane`), parses a `{"verdict": ...}` JSON block, and streams text via `review_output`/`pr_review_output` events. The task review loop (`review_loop.rs`) drives it with a loop-status machine and renders into the Review tab.

The chat path (`acp_manager.rs`) already normalizes ACP updates into `ChatPart`s via `TurnAccumulator` (text, reasoning, **tool**, file_edit, permission, plan) and streams `session_chat` events that the frontend renders with `groupToolParts` + the compact tool rows (`renderChatParts.tsx`). Slash commands in the composer today are **agent-provided** (`runtime.availableCommands`) and are sent to the agent as a normal prompt via `acpSendPrompt`.

The inline-subagent model bridges these: the reviewer should produce **full `ChatPart`s** (like chat) and render **inside** the chat transcript (like chat), but remain a **separate, isolated ACP session** (its own model/prompt/context — a distinct "Bugbot").

## Architecture

```
composer "/review [focus]"  ──intercept──▶  acp_start_review(task_id, focus)         [frontend → Tauri]
                                                   │
                                                   ▼
                                   run_review (evolved): separate reviewer ACP session,
                                   TurnAccumulator → full ChatParts, parse verdict
                                                   │  emits session_chat (chat session id)
                                                   ▼  message = [ ChatPart::Subagent { … } ]
                                   useEventBridge → chat message cache (existing path)
                                                   ▼
                                   ChatMessageRow → renders ChatPart::Subagent as a
                                   collapsible card: header(name, spinner→verdict chip)
                                   + body(groupToolParts over nested parts, reused)
```

### Components

**1. `/review` command interception (frontend) — `src/components/chat/ChatPane.tsx`**
- The composer submit handler checks `trimmed`/its first token for the reserved `/review` command **before** `acpSendPrompt`. On match, it does NOT send a prompt to the chat agent; it calls a new `api.acpStartReview(taskId, focus)` where `focus` is the text after `/review` (trimmed; empty if none).
- `/review` is added to the command menu (`ChatCommandMenu`) as a Nectus app command so it's discoverable alongside `runtime.availableCommands` (a small "app commands" group, or merged list with an app-command marker).
- Guard: if the task has no configured reviewer profile or no worktree, surface an inline system note (a local store `message`/toast or a transient transcript note) telling the user to configure a reviewer — do not call the backend.

**2. Backend command — `native/src/lib.rs` + `native/src/sessions/`**
- New `#[tauri::command] async fn acp_start_review(task_id, focus: Option<String>, ...)` that resolves the task, its worktree cwd, and the configured reviewer profile, then spawns the inline review (async, `tauri::async_runtime::spawn`).
- Reuses the existing per-task resumable reviewer session id (the `review_loop_session_id` storage) to decide resume vs fresh, and the existing review-run recording.

**3. `run_review` evolution — `native/src/sessions/review_runtime.rs`**
- Add a **chat-inline output mode**. Instead of (or in addition to) the text-delta `ReviewSink`, the reviewer accumulates with the chat path's **`TurnAccumulator`** (so it captures reasoning + tool calls + file edits + text as `ChatPart`s, not just prose).
- As the turn streams, emit a **`session_chat` event keyed to the task's chat session**, whose message contains a single `ChatPart::Subagent` part wrapping the accumulator's current snapshot parts, with `status: running` and `done: false`. On turn end: parse the verdict block (self-repair as in #115), strip it from the nested text part(s), set `status: completed`/`failed` + `verdict`, emit `done: true`, and **persist** the message to the chat transcript.
- Auto-approve permissions (unchanged from #115). Custom agents still rejected.
- The reviewer block is a **distinct chat message** (ordered in the transcript at the point `/review` was invoked) — the user's `/review` line need not appear as a user message (or appears as a lightweight "ran /review" affordance — see Open Decisions).

**4. `ChatPart::Subagent` — `native/src/models/chat.rs` + `src/types.ts`**
- New variant: `Subagent { name: String, agent_kind: AgentKind, parts: Vec<ChatPart>, status: SubagentStatus, verdict: Option<VerdictToken> }`.
  - `name` = reviewer profile name (header label, e.g. "Reviewer" or the profile's name).
  - `parts` = the reviewer's normalized nested transcript (existing `ChatPart` variants).
  - `status` = `Running | Completed | Failed` (drives spinner/error state).
  - `verdict` = the shared verdict token (`Clean | Blockers | Feedback`) parsed from the reviewer's verdict block, `None` while running / if unclear. The renderer maps the token to a chip label + `--status-*` color (no separate label type on the wire).
- Serde tag matches the existing `ChatPart` representation (whatever `#[serde(tag = …)]`/rename convention `chat.rs` uses); `src/types.ts` mirrors it.

**5. Inline rendering — `src/lib/chat/renderChatParts.tsx` (+ a new `SubagentBlock` piece)**
- A `Subagent` part renders as a **collapsible card**: header with the reviewer name, a spinner while `Running`, and a **verdict chip** (`--status-success`/`--status-warning`/`--destructive` tokens) once resolved; an error treatment when `Failed`.
- The card **body reuses `groupToolParts(part.parts)` and the existing row renderers** (tool rows, reasoning, text) — no parallel renderer. Collapsed by default once `Completed` (like Codex/Cursor); expandable.
- Lives in the existing transcript flow (`ChatMessageRow` maps message parts; a `Subagent` part yields the card).

**6. Verdict + history**
- Each `/review` is recorded as a **review run** (verdict + the stripped review text) for the facts rail / history, as today.
- The verdict chip on the block is the user-facing surface; the facts-rail "review" card simplifies to "last verdict + jump to the inline block" (no live pane).

### Data flow (traced)

1. User types `/review check the new locking`, submits.
2. Composer detects the reserved command, calls `acpStartReview(taskId, "check the new locking")`.
3. Backend resolves cwd + reviewer profile + prior reviewer session id; spawns the inline review.
4. `run_review` launches the reviewer ACP session, sends the review prompt (+ focus), auto-approves permissions, and folds updates via `TurnAccumulator`.
5. On each update, a `session_chat` event (chat session id, `done:false`) carries a message `[Subagent{ status:Running, parts:<snapshot>, verdict:None }]`.
6. `useEventBridge` routes it to the chat message cache (existing path); `ChatMessageRow` renders the live, growing Subagent card.
7. On turn end: verdict parsed, text stripped, `status:Completed`, `verdict:…`, `done:true`; message persisted; review run recorded.
8. Re-running `/review` resumes the reviewer session (if `loadSession`) with the delta-review prompt and appends a new Subagent block.

### Error handling

- No reviewer configured / no worktree → inline guidance, no backend call.
- Reviewer launch/ACP error → the Subagent block renders `status: Failed` with the error message (no silent stall); a review run records the failure.
- Missing verdict after self-repair → `verdict: None` (block shows "no clear verdict"); run recorded as unclear, as in #115.
- Custom agent reviewer → rejected with the #115 error, surfaced in the block's failed state.

### What retires / changes

- The task **Review tab and `ReviewTerminalPane` usage for tasks** retire; the task stage toggle becomes `Chat | Diff`. `ReviewTerminalPane` stays for the external PR-reviews view.
- The task review **loop-status machine** (`review_loop.rs`'s Running/Reviewing automation) retires in favor of on-demand `/review`; the per-task resumable reviewer session id and review-run recording are kept.
- `review_runtime.rs::run_review` gains the chat-inline output mode; the text-only sink path remains for external PR reviews.

## Testing

Unit/pure (matches the codebase's "test pure logic, validate live in `desktop:dev`" pattern):
- `ChatPart::Subagent` round-trips through serde (Rust) and matches `src/types.ts` (a frontend type/parse test).
- `groupToolParts` over a `Subagent` part's nested `parts` groups reads/searches as it does at top level.
- Verdict → chip-label mapping (Clean/Blockers/Feedback → token + label); `None` while running.
- `/review` parsing: bare `/review` → no focus; `/review <text>` → focus = text; whitespace handling; the reserved-command interception does not fire for a prompt that merely contains "/review" mid-text.
- The "no reviewer configured / no worktree" guard returns guidance without calling the backend.

Live (`desktop:dev`): the reviewer block streams tool activity + reasoning live, resolves to a verdict chip, collapses; re-running resumes a delta review; a launch error renders the failed state.

## Open decisions (resolve in the plan, low-stakes)

- Whether the `/review` invocation shows a lightweight user-side affordance in the transcript (a "ran /review" chip) or only the resulting Subagent block. Lean: a minimal user marker so the transcript reads coherently.
- Exact home of `SubagentStatus`/verdict-label enums (reuse `ReviewVerdict` mapping vs. a small UI-facing label). Lean: reuse the existing verdict token, map to a label in the renderer.

## Future work (out of scope)

- **Model B:** render the host chat agent's own Task subagents (ACP `subagent/create`/`subagent/sendMessage`) as nested blocks — the gap Zed left open. The `ChatPart::Subagent` rendering built here is the foundation for it.
- External PR reviews adopting the same inline Subagent rendering inside a chat-like surface.
</content>
