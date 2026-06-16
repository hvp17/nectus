# Codex Session JSONL Reference

This is a historical map of Codex session rollout files under
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

For the broader app-level state, event, and troubleshooting guide, see
[tracking-and-debugging.md](tracking-and-debugging.md).

Checked against the Codex source on 2026-05-16. Nectus task agents now run through
ACP chat, so the app no longer tails Codex rollout JSONL for task attention,
activity, idle, or resume metadata. The broader event catalog below is an
external snapshot, so treat it as point-in-time — Codex can add or rename event
types.

## Source Files

Paths below are relative to the Codex repository root.

- `codex-rs/protocol/src/protocol.rs`
  - `RolloutLine`
  - `RolloutItem`
  - `EventMsg`
  - `SessionMetaLine`
  - `TurnContextItem`
  - `CompactedItem`
- `codex-rs/protocol/src/items.rs`
  - `TurnItem`
- `codex-rs/protocol/src/models.rs`
  - `ResponseItem`
- `codex-rs/rollout/src/policy.rs`
  - which `RolloutItem`, `ResponseItem`, and `EventMsg` variants are persisted
- `codex-rs/rollout/src/recorder.rs`
  - writer for session rollout JSONL

Generated TypeScript protocol files can help when building UI models, but the
session JSONL source of truth is the Rust protocol plus rollout persistence
policy.

## JSONL Shape

Each line is a `RolloutLine`: a timestamp plus a flattened `RolloutItem`.

```json
{
  "timestamp": "2026-05-16T12:00:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "task_complete",
    "turn_id": "turn-id",
    "last_agent_message": "Done"
  }
}
```

## Top-Level Entry Types

These are the possible `RolloutItem` values.

| JSON `type` | Rust variant | Purpose | Persisted |
| --- | --- | --- | --- |
| `session_meta` | `RolloutItem::SessionMeta` | Session identity and environment metadata. Usually the first line. | Yes |
| `response_item` | `RolloutItem::ResponseItem` | Raw model/conversation/tool history item. Used for replay/resume. | Some variants |
| `compacted` | `RolloutItem::Compacted` | Compaction summary plus optional replacement history. | Yes |
| `turn_context` | `RolloutItem::TurnContext` | Per-turn durable context: cwd, model, sandbox, approvals, instructions, date/timezone. | Yes |
| `event_msg` | `RolloutItem::EventMsg` | Runtime event emitted by Codex. `task_complete` lives here. | Some variants |

## Response Item Types

These appear as `type: "response_item"` with a nested `payload.type`.

Persisted by default:

- `message`
- `reasoning`
- `local_shell_call`
- `function_call`
- `tool_search_call`
- `function_call_output`
- `tool_search_output`
- `custom_tool_call`
- `custom_tool_call_output`
- `web_search_call`
- `image_generation_call`
- `compaction`
- `context_compaction`

Defined but not persisted by rollout policy:

- `compaction_trigger`
- `other`

## Event Message Types

These appear as `type: "event_msg"` with a nested `payload.type`.

### Persisted By Default

These are written in the default limited persistence mode.

| JSON `payload.type` | Rust variant | Notes |
| --- | --- | --- |
| `user_message` | `EventMsg::UserMessage` | User/system input sent to the model. |
| `agent_message` | `EventMsg::AgentMessage` | Agent text output. |
| `agent_reasoning` | `EventMsg::AgentReasoning` | Reasoning summary event. |
| `agent_reasoning_raw_content` | `EventMsg::AgentReasoningRawContent` | Raw reasoning content when enabled. |
| `patch_apply_end` | `EventMsg::PatchApplyEnd` | Patch application completed. |
| `token_count` | `EventMsg::TokenCount` | Running usage/context count. |
| `thread_goal_updated` | `EventMsg::ThreadGoalUpdated` | Goal metadata changed. |
| `context_compacted` | `EventMsg::ContextCompacted` | Conversation context compacted. |
| `entered_review_mode` | `EventMsg::EnteredReviewMode` | Review mode started. |
| `exited_review_mode` | `EventMsg::ExitedReviewMode` | Review mode ended. |
| `mcp_tool_call_end` | `EventMsg::McpToolCallEnd` | MCP call completed. |
| `thread_rolled_back` | `EventMsg::ThreadRolledBack` | Thread history rollback completed. |
| `turn_aborted` | `EventMsg::TurnAborted` | Turn was interrupted/aborted. |
| `task_started` | `EventMsg::TurnStarted` | Legacy v1 wire name. Also accepts alias `turn_started`. |
| `task_complete` | `EventMsg::TurnComplete` | Legacy v1 wire name. Also accepts alias `turn_complete`. This is the current best idle signal. |
| `web_search_end` | `EventMsg::WebSearchEnd` | Web search completed. |
| `image_generation_end` | `EventMsg::ImageGenerationEnd` | Image generation completed. |
| `item_completed` | `EventMsg::ItemCompleted` | Persisted only when the completed item is a plan. |

### Persisted Only In Extended Mode

These are defined, but rollout policy only writes them when the recorder is in
extended persistence mode.

- `error`
- `guardian_assessment`
- `exec_command_end`
- `view_image_tool_call`
- `collab_agent_spawn_end`
- `collab_agent_interaction_end`
- `collab_waiting_end`
- `collab_close_end`
- `collab_resume_end`
- `dynamic_tool_call_request`
- `dynamic_tool_call_response`

### Defined But Not Persisted By Policy

These exist in `EventMsg`, but the rollout persistence policy returns `None`
for them in the checked Codex source.

- `warning`
- `guardian_warning`
- `realtime_conversation_started`
- `realtime_conversation_realtime`
- `realtime_conversation_closed`
- `realtime_conversation_sdp`
- `model_reroute`
- `model_verification`
- `agent_reasoning_section_break`
- `session_configured`
- `mcp_startup_update`
- `mcp_startup_complete`
- `mcp_tool_call_begin`
- `web_search_begin`
- `image_generation_begin`
- `exec_command_begin`
- `exec_command_output_delta`
- `terminal_interaction`
- `exec_approval_request`
- `request_permissions`
- `request_user_input`
- `elicitation_request`
- `apply_patch_approval_request`
- `deprecation_notice`
- `stream_error`
- `patch_apply_begin`
- `patch_apply_updated`
- `turn_diff`
- `realtime_conversation_list_voices_response`
- `plan_update`
- `shutdown_complete`
- `raw_response_item`
- `item_started`
- `hook_started`
- `hook_completed`
- `agent_message_content_delta`
- `plan_delta`
- `reasoning_content_delta`
- `reasoning_raw_content_delta`
- `collab_agent_spawn_begin`
- `collab_agent_interaction_begin`
- `collab_waiting_begin`
- `collab_close_begin`
- `collab_resume_begin`

## Current Nectus Usage

Nectus no longer reads Codex rollout JSONL for task-agent state. Codex task work
uses the ACP provider descriptor in `native/src/sessions/acp.rs`; transcript,
activity, permission requests, usage, and process exit flow through
`session_chat`, `session_chat_usage`, `session_chat_runtime`, and
`chat_session_exited`.

Current behavior:

- No `session_idle`, `session_activity`, or `session_needs_input` events are emitted
  from Codex rollout JSONL.
- No Codex rollout `session_meta` scan is used to resume task chats. ACP resume is
  based on the stored chat row's `acp_session_id` plus provider support for
  `session/load`.
- The reference below remains useful when comparing older databases, older docs,
  or historical task-session behavior.

Important caveat: the checked Codex rollout policy says approval/input request
`event_msg` variants such as `exec_approval_request`, `request_permissions`,
`request_user_input`, and `apply_patch_approval_request` are defined but not
persisted by default. `response_item` function calls are persisted by default in
that historical protocol.

## Observed Sample Entries

In sample Codex rollout files inspected for this snapshot, the observed
top-level entry types were:

- `session_meta`
- `turn_context`
- `response_item`
- `event_msg`

Observed nested `event_msg` payload types:

- `agent_message`
- `item_completed`
- `mcp_tool_call_end`
- `patch_apply_end`
- `task_complete`
- `task_started`
- `token_count`
- `turn_aborted`
- `user_message`
- `web_search_end`

Observed nested `response_item` payload types:

- `custom_tool_call`
- `custom_tool_call_output`
- `function_call`
- `function_call_output`
- `message`
- `reasoning`
- `web_search_call`

## Feature Planning Notes

High-confidence signals from default JSONL:

- Idle/done: `event_msg.payload.type == "task_complete"`
- Active turn started: `task_started`
- Interrupted/aborted: `turn_aborted`
- User input needed: `response_item.payload.type == "function_call"` and
  `response_item.payload.name == "request_user_input"`
- Token/context usage: `token_count`
- User and assistant transcript: `user_message`, `agent_message`, `response_item.message`
- Patch completion: `patch_apply_end`
- Web search completion: `web_search_end`
- MCP completion: `mcp_tool_call_end`
- Context changes: `turn_context`, `context_compacted`, `compacted`

Needs verification before relying on it:

- Approval waiting state from JSONL.
- Permission request state from JSONL.
- Live command output from JSONL.
- Streaming deltas from JSONL.

For those lower-confidence states, Nectus may need either Codex extended rollout
persistence, a different Codex event stream, or a wrapper/API integration instead
of relying only on persisted rollout JSONL.
