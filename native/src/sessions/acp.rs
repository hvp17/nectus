//! ACP (Agent Client Protocol) client session support.
//!
//! This module embeds coding-agent CLIs (Claude Code, Codex, OpenCode)
//! over ACP v0.14 and normalizes their `session/update` notifications into the
//! [`crate::models`] chat part model — the single contract the chat UI renders.
//!
//! Two layers:
//! - [`acp_provider`]: the provider registry's ACP axis — how to launch each
//!   agent in ACP mode over stdio. Adding an agent is one entry here.
//! - [`TurnAccumulator`] + the `map_*` helpers: the **pure, deterministic**
//!   ACP→part normalization. This is the unit-tested heart; the live session glue
//!   (the `AcpManager`, added separately) feeds it updates and emits a snapshot
//!   after each one.
//!
//! Grounded in `agent-client-protocol` 0.14 / schema 0.13.6 (builder + closures
//! API; `Client.builder().on_receive_*(…, on_receive_*!()).connect_with(…)`).

use std::collections::HashMap;

use agent_client_protocol::schema::{
    ContentBlock, PermissionOptionKind, Plan, PlanEntryPriority, PlanEntryStatus,
    RequestPermissionRequest, SessionUpdate, ToolCall, ToolCallContent, ToolCallStatus,
    ToolCallUpdate, ToolKind,
};

use crate::models::{
    AcpCapabilityState, AcpProviderCapabilities, AcpProviderInfo, AcpProviderLaunch,
    AcpProviderMaturity, AgentKind, ChatLocation, ChatMessage, ChatPart, ChatPermissionKind,
    ChatPermissionOption, ChatPlanEntry, ChatPlanStatus, ChatRole, ChatToolStatus,
};

/// How to launch an agent CLI in ACP mode over stdio. The ACP axis of the
/// provider registry — `command` + `args` is the literal argv. For npx-based
/// adapters the macOS GUI-PATH rule applies at spawn time: resolve the binary and
/// set the child `PATH` to `process_util::augmented_path()`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AcpLaunch {
    pub command: String,
    pub args: Vec<String>,
}

/// A provider-specific executable path that must be injected into the ACP
/// adapter's environment before launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AcpExecutableEnv {
    pub var: &'static str,
    pub command: &'static str,
}

/// The ACP axis of the provider registry: it only records facts needed to start
/// a provider through ACP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AcpProviderDescriptor {
    pub display_name: &'static str,
    pub launch: AcpLaunch,
    pub executable_env: Option<AcpExecutableEnv>,
    pub capabilities: AcpProviderCapabilities,
    pub maturity: AcpProviderMaturity,
}

/// The default ACP provider descriptor per agent (June 2026 ACP registry).
///
/// - Claude Code: the `@agentclientprotocol/claude-agent-acp` adapter (most
///   mature; loadSession + permissions + plans) — the Phase 0 spike target.
/// - OpenCode: native `acp` subcommand.
/// - Codex: the `codex-acp` adapter binary.
/// - Antigravity (`agy`): the community `agy-acp` adapter (preview — no native
///   ACP mode yet; limited streaming and no `session/load`).
/// - Custom: no default — ACP launch must be configured by the profile.
pub(crate) fn acp_provider(kind: AgentKind) -> Option<AcpProviderDescriptor> {
    let (display_name, command, args, executable_env, capabilities, maturity): (
        &str,
        &str,
        &[&str],
        Option<AcpExecutableEnv>,
        AcpProviderCapabilities,
        AcpProviderMaturity,
    ) = match kind {
        AgentKind::Claude => (
            "Claude Code",
            "npx",
            &["-y", "@agentclientprotocol/claude-agent-acp"],
            Some(AcpExecutableEnv {
                var: "CLAUDE_CODE_EXECUTABLE",
                command: "claude",
            }),
            AcpProviderCapabilities {
                session_load: AcpCapabilityState::Expected,
                permissions: AcpCapabilityState::Expected,
                images: AcpCapabilityState::Unknown,
            },
            AcpProviderMaturity::Stable,
        ),
        AgentKind::OpenCode => (
            "OpenCode",
            "opencode",
            &["acp"],
            None,
            AcpProviderCapabilities {
                session_load: AcpCapabilityState::Unknown,
                permissions: AcpCapabilityState::Unknown,
                images: AcpCapabilityState::Unknown,
            },
            AcpProviderMaturity::Preview,
        ),
        AgentKind::Codex => (
            "Codex",
            "codex-acp",
            &[],
            None,
            AcpProviderCapabilities {
                session_load: AcpCapabilityState::Unknown,
                permissions: AcpCapabilityState::Unknown,
                images: AcpCapabilityState::Unknown,
            },
            AcpProviderMaturity::Preview,
        ),
        AgentKind::Antigravity => (
            "Antigravity",
            "agy-acp",
            &[],
            Some(AcpExecutableEnv {
                var: "AGY_EXECUTABLE",
                command: "agy",
            }),
            AcpProviderCapabilities {
                session_load: AcpCapabilityState::Unsupported,
                permissions: AcpCapabilityState::Unsupported,
                images: AcpCapabilityState::Unsupported,
            },
            AcpProviderMaturity::Preview,
        ),
        AgentKind::Custom => return None,
    };
    Some(AcpProviderDescriptor {
        display_name,
        launch: AcpLaunch {
            command: command.to_string(),
            args: args.iter().map(|value| value.to_string()).collect(),
        },
        executable_env,
        capabilities,
        maturity,
    })
}

pub(crate) fn acp_provider_infos() -> Vec<AcpProviderInfo> {
    [
        AgentKind::Claude,
        AgentKind::OpenCode,
        AgentKind::Codex,
        AgentKind::Antigravity,
    ]
    .into_iter()
    .filter_map(|kind| {
        let descriptor = acp_provider(kind)?;
        Some(AcpProviderInfo {
            id: kind.as_str().to_string(),
            agent_kind: kind,
            display_name: descriptor.display_name.to_string(),
            launch: AcpProviderLaunch {
                command: descriptor.launch.command,
                args: descriptor.launch.args,
            },
            capabilities: descriptor.capabilities,
            maturity: descriptor.maturity,
        })
    })
    .collect()
}

/// One ordered segment of a turn. Ordering lives here; tool *state* lives in the
/// accumulator's `tools` map so a `ToolCallUpdate` mutates in place without
/// disturbing surrounding text.
enum Segment {
    Text(String),
    Reasoning(String),
    Tool(String),
}

/// Accumulates a single agent turn's ACP `session/update` notifications into a
/// normalized [`ChatMessage`] snapshot. Pure and deterministic: `apply` folds in
/// one update, `snapshot` rebuilds the full part list from accumulated state.
pub(crate) struct TurnAccumulator {
    message_id: String,
    created_at: String,
    segments: Vec<Segment>,
    /// Authoritative ACP tool-call state, keyed by tool-call id. Re-derived into
    /// [`ChatPart::Tool`] (+ file-edit parts) at snapshot time.
    tools: HashMap<String, ToolCall>,
    /// The latest plan, if any. ACP plans are full-replace.
    plan: Option<Plan>,
}

impl TurnAccumulator {
    pub(crate) fn new(message_id: impl Into<String>, created_at: impl Into<String>) -> Self {
        Self {
            message_id: message_id.into(),
            created_at: created_at.into(),
            segments: Vec::new(),
            tools: HashMap::new(),
            plan: None,
        }
    }

    /// Fold one ACP session update into the turn. Unknown / UI-only variants
    /// (mode, config, usage, available commands, session info) are ignored here —
    /// they are surfaced by the live layer, not as message parts.
    pub(crate) fn apply(&mut self, update: &SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                self.push_text(content_block_text(&chunk.content));
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                self.push_reasoning(content_block_text(&chunk.content));
            }
            SessionUpdate::ToolCall(tool_call) => {
                let id = tool_call.tool_call_id.0.to_string();
                if !self.tools.contains_key(&id) {
                    self.segments.push(Segment::Tool(id.clone()));
                }
                self.tools.insert(id, tool_call.clone());
            }
            SessionUpdate::ToolCallUpdate(update) => self.apply_tool_update(update),
            SessionUpdate::Plan(plan) => self.plan = Some(plan.clone()),
            // UserMessageChunk (we render user turns ourselves) and every UI-only
            // variant fall through; SessionUpdate is #[non_exhaustive].
            _ => {}
        }
    }

    /// Rebuild the message snapshot. `completed_at` is `Some` once the turn is
    /// settled (passed in so the accumulator stays deterministic/testable).
    pub(crate) fn snapshot(&self, completed_at: Option<String>) -> ChatMessage {
        let mut parts = Vec::new();
        for segment in &self.segments {
            match segment {
                Segment::Text(text) => parts.push(ChatPart::Text { text: text.clone() }),
                Segment::Reasoning(text) => parts.push(ChatPart::Reasoning { text: text.clone() }),
                Segment::Tool(id) => {
                    if let Some(tool_call) = self.tools.get(id) {
                        // A tool that carried a diff renders as its file-edit row(s)
                        // alone — the generic tool row would just duplicate it
                        // ("Edit foo.rs" above "Edited foo.rs +N -M"). Tools without
                        // a diff (reads, commands, …) still render the tool row.
                        let edits = file_edits_from(tool_call);
                        if edits.is_empty() {
                            parts.push(tool_to_part(tool_call));
                        }
                        parts.extend(edits);
                    }
                }
            }
        }
        if let Some(plan) = &self.plan {
            parts.push(map_plan(plan));
        }
        ChatMessage {
            id: self.message_id.clone(),
            role: ChatRole::Agent,
            parts,
            created_at: self.created_at.clone(),
            completed_at,
        }
    }

    /// Whether the turn produced nothing renderable (no text/reasoning/tool
    /// segments and no plan) — used to skip persisting/emitting an empty bubble
    /// when a prompt errors before any update arrives.
    pub(crate) fn is_empty(&self) -> bool {
        self.segments.is_empty() && self.plan.is_none()
    }

    fn apply_tool_update(&mut self, update: &ToolCallUpdate) {
        let id = update.tool_call_id.0.to_string();
        if let Some(tool_call) = self.tools.get_mut(&id) {
            tool_call.update(update.fields.clone());
        } else if let Ok(tool_call) = ToolCall::try_from(update.clone()) {
            // An update for a tool we never saw a ToolCall for: materialize it if
            // it carries enough (a title) to stand on its own.
            self.segments.push(Segment::Tool(id.clone()));
            self.tools.insert(id, tool_call);
        }
    }

    fn push_text(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        match self.segments.last_mut() {
            Some(Segment::Text(existing)) => merge_stream_chunk(existing, text),
            _ => self.segments.push(Segment::Text(text)),
        }
    }

    fn push_reasoning(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        match self.segments.last_mut() {
            Some(Segment::Reasoning(existing)) => merge_stream_chunk(existing, text),
            _ => self.segments.push(Segment::Reasoning(text)),
        }
    }
}

/// Fold an incoming text/reasoning chunk into the segment accumulated so far.
///
/// Most ACP agents stream pure deltas (each chunk is the next suffix), which we
/// append. Some agents instead re-broadcast the whole message after streaming, or
/// send cumulative snapshots (each chunk carries the full text so far) — both make
/// the incoming chunk start with everything we already have, and appending would
/// duplicate it ("I'll read those files.I'll read those files."). When the chunk is
/// a superset (or exact copy) of the existing text, replace rather than append. A
/// real delta never starts with the entire prior accumulation, so delta agents are
/// unaffected.
fn merge_stream_chunk(existing: &mut String, chunk: String) {
    if chunk.starts_with(existing.as_str()) {
        *existing = chunk;
    } else {
        existing.push_str(&chunk);
    }
}

/// Extract display text from a content block. Non-text blocks (image/audio/
/// resource) carry no inline text for the chat stream — the spike renders text;
/// richer block rendering is a later addition. `ContentBlock` is non-exhaustive.
fn content_block_text(content: &ContentBlock) -> String {
    match content {
        ContentBlock::Text(text) => text.text.clone(),
        _ => String::new(),
    }
}

/// Build the permission part for a `session/request_permission` request.
/// `request_id` is our own id (the live layer mints it and routes the user's
/// answer back through `acp_respond_permission`), not an ACP field.
/// Human-facing title for a permission request — also the policy lookup key.
pub(crate) fn permission_request_title(request: &RequestPermissionRequest) -> String {
    request
        .tool_call
        .fields
        .title
        .clone()
        .unwrap_or_else(|| "Permission required".to_string())
}

/// Resolve the normalized kind for a chosen option id.
pub(crate) fn permission_option_kind_for_id(
    request: &RequestPermissionRequest,
    option_id: &str,
) -> Option<ChatPermissionKind> {
    request
        .options
        .iter()
        .find(|option| option.option_id.0.to_string() == option_id)
        .map(|option| map_permission_kind(option.kind))
}

/// Pick the first matching option id for any of the given ACP kinds (preference order).
pub(crate) fn permission_option_id_for_kinds(
    request: &RequestPermissionRequest,
    kinds: &[PermissionOptionKind],
) -> Option<String> {
    for kind in kinds {
        if let Some(option) = request.options.iter().find(|option| option.kind == *kind) {
            return Some(option.option_id.0.to_string());
        }
    }
    None
}

pub(crate) fn permission_part(
    request_id: impl Into<String>,
    request: &RequestPermissionRequest,
) -> ChatPart {
    let title = request
        .tool_call
        .fields
        .title
        .clone()
        .unwrap_or_else(|| "Permission required".to_string());
    let options = request
        .options
        .iter()
        .map(|option| ChatPermissionOption {
            option_id: option.option_id.0.to_string(),
            label: option.name.clone(),
            kind: map_permission_kind(option.kind),
        })
        .collect();
    ChatPart::Permission {
        request_id: request_id.into(),
        title,
        options,
    }
}

fn tool_to_part(tool_call: &ToolCall) -> ChatPart {
    ChatPart::Tool {
        tool_call_id: tool_call.tool_call_id.0.to_string(),
        title: tool_call.title.clone(),
        kind: tool_kind_label(tool_call.kind),
        status: map_tool_status(tool_call.status),
        locations: tool_call
            .locations
            .iter()
            .map(|location| ChatLocation {
                path: location.path.to_string_lossy().to_string(),
                line: location.line,
            })
            .collect(),
        raw_input: tool_call.raw_input.clone(),
        output: tool_output_text(&tool_call.content),
    }
}

/// Concatenate human-facing text from a tool's content blocks (Diff and Terminal
/// content are rendered as their own parts / out of band, not folded into output).
fn tool_output_text(content: &[ToolCallContent]) -> Option<String> {
    let mut out = String::new();
    for item in content {
        if let ToolCallContent::Content(block) = item {
            let text = content_block_text(&block.content);
            if !text.is_empty() {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&text);
            }
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Derive file-edit parts from a tool's Diff content. Additions/deletions are a
/// line-count approximation; `diff` carries the new text for the diff pane.
fn file_edits_from(tool_call: &ToolCall) -> Vec<ChatPart> {
    tool_call
        .content
        .iter()
        .filter_map(|item| match item {
            ToolCallContent::Diff(diff) => {
                let new_lines = diff.new_text.lines().count() as u32;
                let old_lines = diff
                    .old_text
                    .as_deref()
                    .map(|text| text.lines().count() as u32)
                    .unwrap_or(0);
                Some(ChatPart::FileEdit {
                    path: diff.path.to_string_lossy().to_string(),
                    additions: new_lines.saturating_sub(old_lines.min(new_lines)),
                    deletions: old_lines.saturating_sub(new_lines.min(old_lines)),
                    diff: Some(diff.new_text.clone()),
                })
            }
            _ => None,
        })
        .collect()
}

fn map_plan(plan: &Plan) -> ChatPart {
    ChatPart::Plan {
        entries: plan
            .entries
            .iter()
            .map(|entry| ChatPlanEntry {
                content: entry.content.clone(),
                status: map_plan_status(&entry.status),
                priority: Some(plan_priority_label(&entry.priority).to_string()),
            })
            .collect(),
    }
}

fn map_tool_status(status: ToolCallStatus) -> ChatToolStatus {
    match status {
        ToolCallStatus::Pending => ChatToolStatus::Pending,
        ToolCallStatus::InProgress => ChatToolStatus::Running,
        ToolCallStatus::Completed => ChatToolStatus::Completed,
        ToolCallStatus::Failed => ChatToolStatus::Failed,
        // ToolCallStatus is #[non_exhaustive]; treat the unknown as pending.
        _ => ChatToolStatus::Pending,
    }
}

/// The tool category label (drives the card icon). `Other` → no label.
fn tool_kind_label(kind: ToolKind) -> Option<String> {
    let label = match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        _ => return None,
    };
    Some(label.to_string())
}

fn map_permission_kind(kind: PermissionOptionKind) -> ChatPermissionKind {
    match kind {
        PermissionOptionKind::AllowOnce => ChatPermissionKind::AllowOnce,
        PermissionOptionKind::AllowAlways => ChatPermissionKind::AllowAlways,
        PermissionOptionKind::RejectOnce => ChatPermissionKind::RejectOnce,
        PermissionOptionKind::RejectAlways => ChatPermissionKind::RejectAlways,
        // #[non_exhaustive]; an unknown kind is treated as a one-time reject.
        _ => ChatPermissionKind::RejectOnce,
    }
}

fn map_plan_status(status: &PlanEntryStatus) -> ChatPlanStatus {
    match status {
        PlanEntryStatus::Pending => ChatPlanStatus::Pending,
        PlanEntryStatus::InProgress => ChatPlanStatus::InProgress,
        PlanEntryStatus::Completed => ChatPlanStatus::Completed,
        _ => ChatPlanStatus::Pending,
    }
}

fn plan_priority_label(priority: &PlanEntryPriority) -> &'static str {
    match priority {
        PlanEntryPriority::High => "high",
        PlanEntryPriority::Medium => "medium",
        PlanEntryPriority::Low => "low",
        _ => "medium",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{
        ContentChunk, Diff, PermissionOption, PlanEntry, TextContent, ToolCallUpdateFields,
    };

    fn text_update(text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
            text,
        ))))
    }

    fn thought_update(text: &str) -> SessionUpdate {
        SessionUpdate::AgentThoughtChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
            text,
        ))))
    }

    #[test]
    fn launch_matrix_covers_acp_agents_and_skips_custom() {
        assert_eq!(
            acp_provider(AgentKind::Claude).unwrap().launch.command,
            "npx"
        );
        assert_eq!(
            acp_provider(AgentKind::Antigravity).unwrap().launch.command,
            "agy-acp"
        );
        assert_eq!(
            acp_provider(AgentKind::OpenCode).unwrap().launch.args,
            vec!["acp"]
        );
        assert_eq!(
            acp_provider(AgentKind::Codex).unwrap().launch.command,
            "codex-acp"
        );
        assert!(acp_provider(AgentKind::Custom).is_none());
    }

    #[test]
    fn provider_descriptor_carries_acp_launch_and_env_metadata() {
        let claude = acp_provider(AgentKind::Claude).unwrap();
        assert_eq!(claude.display_name, "Claude Code");
        assert_eq!(claude.launch.command, "npx");
        assert_eq!(
            claude.executable_env,
            Some(AcpExecutableEnv {
                var: "CLAUDE_CODE_EXECUTABLE",
                command: "claude",
            })
        );

        let opencode = acp_provider(AgentKind::OpenCode).unwrap();
        assert_eq!(opencode.display_name, "OpenCode");
        assert_eq!(opencode.launch.args, vec!["acp"]);
        assert_eq!(opencode.executable_env, None);

        let antigravity = acp_provider(AgentKind::Antigravity).unwrap();
        assert_eq!(antigravity.launch.command, "agy-acp");
        assert_eq!(antigravity.maturity, AcpProviderMaturity::Preview);
        assert!(acp_provider(AgentKind::Custom).is_none());
    }

    #[test]
    fn provider_infos_export_capabilities_for_the_ui() {
        let infos = acp_provider_infos();
        let kinds: Vec<_> = infos.iter().map(|info| info.agent_kind).collect();
        assert_eq!(
            kinds,
            vec![
                AgentKind::Claude,
                AgentKind::OpenCode,
                AgentKind::Codex,
                AgentKind::Antigravity,
            ]
        );

        let claude = infos
            .iter()
            .find(|info| info.agent_kind == AgentKind::Claude)
            .unwrap();
        assert_eq!(claude.id, "claude");
        assert_eq!(claude.display_name, "Claude Code");
        assert_eq!(claude.launch.command, "npx");
        assert_eq!(
            claude.capabilities.session_load,
            AcpCapabilityState::Expected
        );
        assert_eq!(
            claude.capabilities.permissions,
            AcpCapabilityState::Expected
        );
        assert_eq!(claude.capabilities.images, AcpCapabilityState::Unknown);

        let antigravity = infos
            .iter()
            .find(|info| info.agent_kind == AgentKind::Antigravity)
            .unwrap();
        assert_eq!(antigravity.maturity, AcpProviderMaturity::Preview);
        assert!(!infos
            .iter()
            .any(|info| info.agent_kind == AgentKind::Custom));
    }

    #[test]
    fn consecutive_text_chunks_merge_into_one_part() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&text_update("Hello, "));
        acc.apply(&text_update("world"));
        let message = acc.snapshot(None);
        assert_eq!(message.parts.len(), 1);
        assert_eq!(
            message.parts[0],
            ChatPart::Text {
                text: "Hello, world".to_string()
            }
        );
        assert_eq!(message.role, ChatRole::Agent);
        assert_eq!(message.completed_at, None);
    }

    #[test]
    fn reasoning_then_text_are_separate_ordered_parts() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&thought_update("thinking..."));
        acc.apply(&text_update("answer"));
        let message = acc.snapshot(Some("t1".to_string()));
        assert_eq!(
            message.parts,
            vec![
                ChatPart::Reasoning {
                    text: "thinking...".to_string()
                },
                ChatPart::Text {
                    text: "answer".to_string()
                },
            ]
        );
        assert_eq!(message.completed_at, Some("t1".to_string()));
    }

    #[test]
    fn tool_call_then_update_mutates_in_place_with_status_and_output() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&SessionUpdate::ToolCall(
            ToolCall::new("call_1", "Read file")
                .kind(ToolKind::Read)
                .status(ToolCallStatus::InProgress),
        ));
        // a stray text chunk after the tool starts a new text part (ordering)
        acc.apply(&text_update("working"));
        acc.apply(&SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "call_1",
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .content(vec![ToolCallContent::from(ContentBlock::Text(
                    TextContent::new("file contents"),
                ))]),
        )));
        let message = acc.snapshot(Some("t1".to_string()));
        // tool part (index 0) updated in place; text part (index 1) after it
        assert_eq!(message.parts.len(), 2);
        match &message.parts[0] {
            ChatPart::Tool {
                tool_call_id,
                title,
                kind,
                status,
                output,
                ..
            } => {
                assert_eq!(tool_call_id, "call_1");
                assert_eq!(title, "Read file");
                assert_eq!(kind.as_deref(), Some("read"));
                assert_eq!(*status, ChatToolStatus::Completed);
                assert_eq!(output.as_deref(), Some("file contents"));
            }
            other => panic!("expected tool part, got {other:?}"),
        }
        assert_eq!(
            message.parts[1],
            ChatPart::Text {
                text: "working".to_string()
            }
        );
    }

    #[test]
    fn tool_diff_content_becomes_a_file_edit_part() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&SessionUpdate::ToolCall(
            ToolCall::new("call_1", "Edit file")
                .kind(ToolKind::Edit)
                .status(ToolCallStatus::Completed)
                .content(vec![ToolCallContent::Diff(
                    Diff::new("src/main.rs", "line a\nline b\nline c")
                        .old_text("line a".to_string()),
                )]),
        ));
        let message = acc.snapshot(Some("t1".to_string()));
        // A diff-bearing tool renders as the FileEdit row alone — the generic tool
        // row is suppressed so it isn't "Edit foo" above "Edited foo +N -M".
        assert_eq!(message.parts.len(), 1);
        match &message.parts[0] {
            ChatPart::FileEdit {
                path,
                additions,
                deletions,
                diff,
            } => {
                assert_eq!(path, "src/main.rs");
                assert_eq!(*additions, 2); // 3 new lines - 1 old line
                assert_eq!(*deletions, 0);
                assert!(diff.as_deref().unwrap().contains("line c"));
            }
            other => panic!("expected file_edit part, got {other:?}"),
        }
    }

    fn text_of(message: &ChatMessage) -> Vec<&str> {
        message
            .parts
            .iter()
            .filter_map(|p| match p {
                ChatPart::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn delta_text_chunks_are_appended() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&text_update("Hello "));
        acc.apply(&text_update("world"));
        let message = acc.snapshot(None);
        assert_eq!(text_of(&message), vec!["Hello world"]);
    }

    #[test]
    fn a_full_rebroadcast_chunk_does_not_duplicate_text() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&text_update("I'll read those files."));
        // Agent re-sends the assembled message after streaming it.
        acc.apply(&text_update("I'll read those files."));
        let message = acc.snapshot(None);
        assert_eq!(text_of(&message), vec!["I'll read those files."]);
    }

    #[test]
    fn cumulative_snapshot_chunks_replace_rather_than_append() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&text_update("The "));
        acc.apply(&text_update("The cat "));
        acc.apply(&text_update("The cat sat."));
        let message = acc.snapshot(None);
        assert_eq!(text_of(&message), vec!["The cat sat."]);
    }

    #[test]
    fn plan_maps_to_a_single_plan_part() {
        let mut acc = TurnAccumulator::new("m1", "t0");
        acc.apply(&SessionUpdate::Plan(Plan::new(vec![
            PlanEntry::new(
                "step one",
                PlanEntryPriority::High,
                PlanEntryStatus::Completed,
            ),
            PlanEntry::new(
                "step two",
                PlanEntryPriority::Medium,
                PlanEntryStatus::InProgress,
            ),
        ])));
        let message = acc.snapshot(None);
        match &message.parts[0] {
            ChatPart::Plan { entries } => {
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[0].status, ChatPlanStatus::Completed);
                assert_eq!(entries[0].priority.as_deref(), Some("high"));
                assert_eq!(entries[1].status, ChatPlanStatus::InProgress);
            }
            other => panic!("expected plan part, got {other:?}"),
        }
    }

    #[test]
    fn permission_request_maps_options_with_name_as_label() {
        let request = RequestPermissionRequest::new(
            "sess_1",
            ToolCallUpdate::new(
                "call_1",
                ToolCallUpdateFields::new().title("Run rm -rf".to_string()),
            ),
            vec![
                PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
                PermissionOption::new("deny", "Deny", PermissionOptionKind::RejectOnce),
            ],
        );
        let part = permission_part("perm_1", &request);
        match part {
            ChatPart::Permission {
                request_id,
                title,
                options,
            } => {
                assert_eq!(request_id, "perm_1");
                assert_eq!(title, "Run rm -rf");
                assert_eq!(options.len(), 2);
                assert_eq!(options[0].label, "Allow");
                assert_eq!(options[0].kind, ChatPermissionKind::AllowOnce);
                assert_eq!(options[1].kind, ChatPermissionKind::RejectOnce);
            }
            other => panic!("expected permission part, got {other:?}"),
        }
    }
}
