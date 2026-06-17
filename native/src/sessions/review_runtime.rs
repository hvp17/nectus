//! Headless ACP review driver. Runs one agent turn over ACP with no human
//! present: auto-approves every permission request, streams the agent's message
//! to the read-only Review pane, and captures the final review text plus a
//! validated verdict (with one-shot self-repair). Shared by the task review loop
//! (`review_loop.rs`), single PR reviews (`pr_review.rs`), and consensus
//! (`pr_consensus.rs`). The live turn is validated via `pnpm desktop:dev`; only
//! the pure helpers below are unit-tested, mirroring `acp_manager.rs`.

/// Append `chunk` to `full`, returning the newly-appended suffix to stream live
/// (with its start offset), or `None` when the chunk added nothing. Handles an
/// agent that re-broadcasts a cumulative snapshot (the chunk is a superset that
/// starts with what we already have) by replacing rather than double-counting.
pub(super) fn accumulate_delta(
    full: &mut String,
    streamed: &mut usize,
    chunk: &str,
) -> Option<(String, usize)> {
    if !chunk.is_empty() && chunk.starts_with(full.as_str()) {
        *full = chunk.to_string();
    } else {
        full.push_str(chunk);
    }
    if full.len() > *streamed {
        let offset = *streamed;
        let delta = full[*streamed..].to_string();
        *streamed = full.len();
        Some((delta, offset))
    } else {
        None
    }
}

use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::schema::{
    ContentBlock, LoadSessionRequest, NewSessionRequest, PermissionOptionKind, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use parking_lot::Mutex as DbMutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::acp::{
    acp_provider, content_block_text, permission_option_id_for_kinds, TurnAccumulator,
};
use super::acp_manager::{build_initialize_request, launch_argv_for_profile};
use super::verdict::{parse_verdict_block, VerdictToken};
use crate::db::Database;
use crate::models::{
    AgentProfile, ChatMessage, ChatMessageEvent, ChatPart, ChatRole, PrReviewOutputEvent,
    ReviewOutputEvent, ReviewVerdictLabel, SubagentStatus,
};

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Project the internal verdict token to its serializable wire label for the
/// subagent chip.
pub(super) fn verdict_label(token: Option<VerdictToken>) -> Option<ReviewVerdictLabel> {
    match token {
        Some(VerdictToken::Clean) => Some(ReviewVerdictLabel::Clean),
        Some(VerdictToken::Blockers) => Some(ReviewVerdictLabel::Blockers),
        Some(VerdictToken::Feedback) => Some(ReviewVerdictLabel::Feedback),
        None => None,
    }
}

/// Build the host-transcript message that carries the reviewer's nested run.
#[allow(clippy::too_many_arguments)]
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

/// Where a review's live text is streamed: the task review pane (keyed by task id)
/// or a single PR review (keyed by review id). Consensus members stream nowhere.
pub(super) enum ReviewTarget {
    Task(i64),
    PrReview(i64),
}

/// A live-output channel for one review run.
pub(super) struct ReviewSink {
    pub app: AppHandle,
    pub target: ReviewTarget,
}

impl ReviewSink {
    fn emit(&self, data: String, start_offset: u64) {
        match self.target {
            ReviewTarget::Task(task_id) => {
                let _ = self.app.emit(
                    "review_output",
                    ReviewOutputEvent {
                        task_id,
                        data,
                        start_offset,
                    },
                );
            }
            ReviewTarget::PrReview(review_id) => {
                let _ = self.app.emit(
                    "pr_review_output",
                    PrReviewOutputEvent {
                        review_id,
                        data,
                        start_offset,
                    },
                );
            }
        }
    }
}

/// One review run's captured result: the human-facing review (verdict block
/// stripped), the parsed verdict (None => no clear verdict), and the ACP session
/// id to persist + resume.
pub(super) struct ReviewRun {
    pub text: String,
    pub verdict: Option<VerdictToken>,
    pub session_id: Option<String>,
}

/// Follow-up prompt sent in the same session when the first turn produced no valid
/// verdict block. Its output is parsed for the verdict but not streamed or kept.
const VERDICT_REPAIR_PROMPT: &str = "Reply with ONLY a fenced ```json block containing \
{\"verdict\": \"clean\" | \"blockers\" | \"feedback\"} and nothing else.";

/// The per-run behavior that distinguishes a review driver: how each ACP update
/// is captured/surfaced, and how the captured turn text is reproduced for verdict
/// parsing. The launch/initialize/session/permission/self-repair scaffolding is
/// identical across drivers and lives in [`drive_review_turn`]; only this differs.
///
/// `run_review` folds chunks into a flat text buffer and streams deltas to the
/// read-only pane; `run_inline_review` folds every update into a
/// [`TurnAccumulator`] and emits a `Subagent` chat message. The trait is
/// `Send + Sync` so its `Arc` can be shared with the `'static` notification
/// handler closure and the connect closure.
trait ReviewObserver: Send + Sync + 'static {
    /// Fold one ACP update in (and surface it live, if applicable). Called from
    /// the notification handler for every update of the in-flight turn.
    fn on_update<'a>(
        &'a self,
        update: &'a SessionUpdate,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>>;

    /// The captured turn's concatenated text, for verdict parsing. Called once the
    /// first prompt turn has settled.
    fn finalize_text<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + Send + 'a>>;

    /// Begin a fresh capture buffer for the next turn and stop surfacing it live.
    /// Called before the silent self-repair turn so its output is parsed for the
    /// verdict but neither streamed nor kept.
    fn begin_silent_turn<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>>;
}

/// The shared headless-review scaffolding: resolve the ACP provider (rejecting
/// Custom agents), launch the reviewer, drive `initialize` → `session/load`
/// (capability + resume gated) or `session/new` → one prompt turn, then run the
/// one-shot verdict self-repair. Per-update handling and final text capture are
/// delegated to `observer`; the only differences between `run_review` and
/// `run_inline_review` live there.
async fn drive_review_turn<O: ReviewObserver>(
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
    resume: Option<&str>,
    observer: Arc<O>,
) -> Result<ReviewRun, String> {
    let provider = acp_provider(reviewer.agent_kind).ok_or_else(|| {
        format!(
            "{} is a Custom agent and cannot run ACP reviews; choose an ACP provider \
             (Claude, Codex, OpenCode, or Antigravity).",
            reviewer.name
        )
    })?;
    let argv = launch_argv_for_profile(&provider, &reviewer.env);
    let transport = AcpAgent::from_args(argv)
        .map_err(|error| format!("Failed to launch reviewer {}: {error}", reviewer.name))?;

    let note_observer = observer.clone();
    let connect_observer = observer;

    let cwd_owned = cwd.to_path_buf();
    let prompt_owned = prompt.to_string();
    let resume_owned = resume.map(str::to_string);

    let connect_result = Client
        .builder()
        .name("nectus-desktop")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                note_observer.on_update(&notification.update).await;
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                // Headless: there is no human, so auto-approve. Prefer a one-time
                // allow, falling back to allow-always; cancel if neither is offered.
                let option_id = permission_option_id_for_kinds(
                    &request,
                    &[
                        PermissionOptionKind::AllowOnce,
                        PermissionOptionKind::AllowAlways,
                    ],
                );
                let outcome = match option_id {
                    Some(id) => {
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id))
                    }
                    None => RequestPermissionOutcome::Cancelled,
                };
                let _ = responder.respond(RequestPermissionResponse::new(outcome));
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, move |cx: ConnectionTo<Agent>| async move {
            let initialize = cx
                .send_request(build_initialize_request())
                .block_task()
                .await?;
            let load_supported = initialize.agent_capabilities.load_session;

            let session_id = if let (Some(resume), true) = (resume_owned.as_deref(), load_supported)
            {
                let sid = SessionId::from(resume.to_string());
                cx.send_request(LoadSessionRequest::new(sid.clone(), cwd_owned.clone()))
                    .block_task()
                    .await?;
                sid
            } else {
                let new_session = cx
                    .send_request(NewSessionRequest::new(cwd_owned.clone()))
                    .block_task()
                    .await?;
                new_session.session_id
            };

            let content = vec![ContentBlock::Text(TextContent::new(prompt_owned.clone()))];
            cx.send_request(PromptRequest::new(session_id.clone(), content))
                .block_task()
                .await?;

            let first_text = connect_observer.finalize_text().await;
            let (mut verdict, review_text) = parse_verdict_block(&first_text);

            // One-shot self-repair: if the agent didn't emit a parseable verdict
            // block, ask once more for just the block. The repair output is parsed
            // for a verdict but neither streamed nor kept in the review text.
            if verdict.is_none() {
                // Start the repair turn from an empty buffer so its reply stands
                // alone; the first turn's prose is already captured in `review_text`.
                // The first prompt's `block_task().await` has returned, so that
                // turn's chunks are all folded in — beginning a silent turn now can't
                // drop them, and stops the repair output from being surfaced.
                connect_observer.begin_silent_turn().await;
                let repair = vec![ContentBlock::Text(TextContent::new(
                    VERDICT_REPAIR_PROMPT.to_string(),
                ))];
                if cx
                    .send_request(PromptRequest::new(session_id.clone(), repair))
                    .block_task()
                    .await
                    .is_ok()
                {
                    let repair_text = connect_observer.finalize_text().await;
                    let (repair_verdict, _) = parse_verdict_block(&repair_text);
                    verdict = repair_verdict;
                }
            }

            Ok::<ReviewRun, agent_client_protocol::Error>(ReviewRun {
                text: review_text,
                verdict,
                session_id: Some(session_id.to_string()),
            })
        })
        .await;

    connect_result.map_err(|error| format!("Reviewer ACP error: {error}"))
}

/// The pane-streaming observer used by `run_review`: a flat text buffer streamed
/// to the read-only Review pane (or a single PR review) via a [`ReviewSink`].
struct PaneObserver {
    /// The captured text of the current turn (the verdict parser reads this).
    /// Cleared by `begin_silent_turn` before the self-repair turn so the repair
    /// reply is parsed on its own.
    full: Mutex<String>,
    /// Bytes already streamed live to the sink (reset to 0 by `begin_silent_turn`).
    streamed: Mutex<usize>,
    /// Whether to stream the live delta to the sink. Flipped off for the silent
    /// self-repair turn — its text still lands in `full` for verdict parsing but is
    /// not shown.
    streaming: Mutex<bool>,
    sink: Option<ReviewSink>,
}

impl ReviewObserver for PaneObserver {
    fn on_update<'a>(
        &'a self,
        update: &'a SessionUpdate,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            if let SessionUpdate::AgentMessageChunk(chunk) = update {
                let text = content_block_text(&chunk.content);
                if !text.is_empty() {
                    // The `full`/`streamed` guards are dropped before locking
                    // `streaming`, so no two of these are ever held at once.
                    let delta = {
                        let mut full = self.full.lock().await;
                        let mut streamed = self.streamed.lock().await;
                        accumulate_delta(&mut full, &mut streamed, &text)
                    };
                    if let Some((delta, offset)) = delta {
                        if *self.streaming.lock().await {
                            if let Some(sink) = &self.sink {
                                sink.emit(delta, offset as u64);
                            }
                        }
                    }
                }
            }
        })
    }

    fn finalize_text<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + Send + 'a>> {
        Box::pin(async move { self.full.lock().await.clone() })
    }

    fn begin_silent_turn<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            *self.streaming.lock().await = false;
            self.full.lock().await.clear();
            *self.streamed.lock().await = 0;
        })
    }
}

/// Drive one headless ACP review turn in `cwd` and return the captured review.
/// `resume` is a prior ACP session id (used via `session/load` only when the agent
/// advertises `loadSession`). `sink` streams the agent's message live; pass `None`
/// for consensus members. Custom agents have no ACP descriptor and are rejected.
pub(super) async fn run_review(
    app: AppHandle,
    db: Arc<DbMutex<Database>>,
    reviewer: &AgentProfile,
    cwd: &Path,
    prompt: &str,
    resume: Option<&str>,
    sink: Option<ReviewSink>,
) -> Result<ReviewRun, String> {
    // `app` (the sink carries its own handle) and `db` are currently unused; both are
    // kept for a uniform call signature and reserved for future runtime persistence.
    let _ = (&app, &db);
    let observer = Arc::new(PaneObserver {
        full: Mutex::new(String::new()),
        streamed: Mutex::new(0),
        streaming: Mutex::new(true),
        sink,
    });
    drive_review_turn(reviewer, cwd, prompt, resume, observer).await
}

/// Concatenate a turn's `ChatPart::Text` parts (in order, newline-joined) — the
/// reviewer's prose, fed to the verdict parser.
fn text_of(parts: &[ChatPart]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            ChatPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Replace the trailing `ChatPart::Text` part's text with `stripped` (the
/// verdict-block-stripped prose), so the rendered subagent block does not show the
/// machine verdict marker. Other parts (tool calls, reasoning, file edits) are
/// untouched. A trailing whitespace-only stripped text drops the part entirely.
fn strip_verdict_from_parts(mut parts: Vec<ChatPart>, stripped: &str) -> Vec<ChatPart> {
    if let Some(idx) = parts
        .iter()
        .rposition(|part| matches!(part, ChatPart::Text { .. }))
    {
        if stripped.trim().is_empty() {
            parts.remove(idx);
        } else {
            parts[idx] = ChatPart::Text {
                text: stripped.to_string(),
            };
        }
    }
    parts
}

/// The inline observer used by `run_inline_review`: folds every ACP update into a
/// [`TurnAccumulator`] and emits a `Subagent` host-transcript message after each
/// one, so the reviewer's full activity (tool calls + reasoning + text) streams
/// inline in the task chat. Once the verdict self-repair turn begins, emission
/// stops (`emitting = false`): the repair output is still folded in for verdict
/// parsing but neither surfaced nor kept.
struct InlineObserver {
    app: AppHandle,
    chat_session_id: String,
    task_id: i64,
    agent_profile_id: Option<i64>,
    reviewer: AgentProfile,
    message_id: String,
    /// The subagent message's birth time — stable across the running snapshots and
    /// the final one (also seeds the accumulator).
    created_at: String,
    /// The reviewer's evolving normalized transcript.
    accumulator: Mutex<TurnAccumulator>,
    /// Whether to emit the running `Subagent` snapshot. Flipped off for the silent
    /// self-repair turn.
    emitting: Mutex<bool>,
    /// The first turn's displayed parts, snapshotted at the moment the silent
    /// self-repair turn begins, so the final message shows the user-facing review
    /// and not the repair turn's verdict-only output. `None` when no repair ran.
    pre_repair_parts: Mutex<Option<Vec<ChatPart>>>,
}

impl ReviewObserver for InlineObserver {
    fn on_update<'a>(
        &'a self,
        update: &'a SessionUpdate,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            // Snapshot the running parts under the accumulator lock, then release it
            // before emitting (no `.await` is held across the sync `app.emit`).
            let parts = {
                let mut accumulator = self.accumulator.lock().await;
                accumulator.apply(update);
                accumulator.snapshot(None).parts
            };
            if !*self.emitting.lock().await {
                return;
            }
            let message = subagent_message(
                &self.message_id,
                &self.created_at,
                &self.reviewer,
                parts,
                SubagentStatus::Running,
                None,
                None,
            );
            let _ = self.app.emit(
                "session_chat",
                ChatMessageEvent {
                    session_id: self.chat_session_id.clone(),
                    task_id: self.task_id,
                    agent_profile_id: self.agent_profile_id,
                    message,
                    done: false,
                },
            );
        })
    }

    fn finalize_text<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + Send + 'a>> {
        Box::pin(async move { text_of(&self.accumulator.lock().await.snapshot(None).parts) })
    }

    fn begin_silent_turn<'a>(
        &'a self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            // Stop surfacing further updates; the repair turn's output is folded in
            // only so its verdict block can be parsed, then discarded. Snapshot the
            // first turn's displayed parts now so the final message shows the real
            // review and not the repair turn's verdict-only output appended on top.
            // `finalize_text` after the repair turn still re-reads the accumulator
            // (first-turn text + repair chunks); the LAST valid verdict block wins in
            // `parse_verdict_block`, so the repair verdict is picked up.
            *self.emitting.lock().await = false;
            let parts = self.accumulator.lock().await.snapshot(None).parts;
            *self.pre_repair_parts.lock().await = Some(parts);
        })
    }
}

/// Drive one headless ACP review turn in `cwd` and surface the reviewer's full
/// activity **inline in the task's chat transcript** as a `Subagent` message
/// (instead of the read-only Review pane). Mirrors `run_review`'s ACP scaffolding
/// (shared via [`drive_review_turn`]); the difference is that every ACP update is
/// folded into a [`TurnAccumulator`] and emitted as a `session_chat` event, and the
/// settled message is persisted. `resume` is a prior ACP session id (used via
/// `session/load` only when the agent advertises `loadSession`). Returns the
/// captured `ReviewRun` (verdict-block-stripped text + token + session id); on a
/// launch/ACP error a `Failed` subagent message is persisted/emitted and the error
/// is returned.
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
) -> Result<ReviewRun, String> {
    let created_at = now();
    let accumulator = TurnAccumulator::new(message_id.clone(), created_at.clone());
    let observer = Arc::new(InlineObserver {
        app: app.clone(),
        chat_session_id: chat_session_id.clone(),
        task_id,
        agent_profile_id,
        reviewer: reviewer.clone(),
        message_id: message_id.clone(),
        created_at,
        accumulator: Mutex::new(accumulator),
        emitting: Mutex::new(true),
        pre_repair_parts: Mutex::new(None),
    });

    let result = drive_review_turn(
        &reviewer,
        &cwd,
        &prompt,
        resume.as_deref(),
        observer.clone(),
    )
    .await;

    match result {
        Ok(run) => {
            // The displayed nested parts are the first turn's transcript (the
            // pre-repair snapshot when a verdict self-repair ran, else the live
            // accumulator) with the verdict block stripped from the trailing text.
            let raw_parts = match observer.pre_repair_parts.lock().await.take() {
                Some(parts) => parts,
                None => observer.accumulator.lock().await.snapshot(None).parts,
            };
            let nested_parts = strip_verdict_from_parts(raw_parts, &run.text);
            let final_message = subagent_message(
                &message_id,
                &observer.created_at,
                &reviewer,
                nested_parts,
                SubagentStatus::Completed,
                verdict_label(run.verdict),
                Some(now()),
            );
            db.lock()
                .append_chat_message(&chat_session_id, task_id, &final_message)?;
            let _ = app.emit(
                "session_chat",
                ChatMessageEvent {
                    session_id: chat_session_id.clone(),
                    task_id,
                    agent_profile_id,
                    message: final_message,
                    done: true,
                },
            );
            Ok(run)
        }
        Err(error) => {
            let failed = subagent_message(
                &message_id,
                &observer.created_at,
                &reviewer,
                vec![ChatPart::Text {
                    text: error.clone(),
                }],
                SubagentStatus::Failed,
                None,
                Some(now()),
            );
            if let Err(persist_error) =
                db.lock()
                    .append_chat_message(&chat_session_id, task_id, &failed)
            {
                tracing::warn!(
                    error = %persist_error,
                    %task_id,
                    "failed to persist inline-review failure message"
                );
            }
            let _ = app.emit(
                "session_chat",
                ChatMessageEvent {
                    session_id: chat_session_id,
                    task_id,
                    agent_profile_id,
                    message: failed,
                    done: true,
                },
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AgentKind;

    fn test_reviewer() -> AgentProfile {
        AgentProfile {
            id: 1,
            name: "Claude Reviewer".to_string(),
            agent_kind: AgentKind::Claude,
            command: "claude".to_string(),
            model: None,
            args: Vec::new(),
            env: Default::default(),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn verdict_label_projects_each_token() {
        use super::super::verdict::VerdictToken;
        use crate::models::ReviewVerdictLabel;
        assert_eq!(
            verdict_label(Some(VerdictToken::Clean)),
            Some(ReviewVerdictLabel::Clean)
        );
        assert_eq!(
            verdict_label(Some(VerdictToken::Blockers)),
            Some(ReviewVerdictLabel::Blockers)
        );
        assert_eq!(
            verdict_label(Some(VerdictToken::Feedback)),
            Some(ReviewVerdictLabel::Feedback)
        );
        assert_eq!(verdict_label(None), None);
    }

    #[test]
    fn subagent_message_wraps_nested_parts() {
        let reviewer = test_reviewer();
        let msg = subagent_message(
            "rev-1",
            "now",
            &reviewer,
            vec![ChatPart::Text { text: "ok".into() }],
            SubagentStatus::Running,
            None,
            None,
        );
        assert_eq!(msg.parts.len(), 1);
        match &msg.parts[0] {
            ChatPart::Subagent {
                name,
                parts,
                status,
                verdict,
                ..
            } => {
                assert_eq!(name, "Claude Reviewer");
                assert_eq!(parts.len(), 1);
                assert_eq!(*status, SubagentStatus::Running);
                assert!(verdict.is_none());
            }
            _ => panic!("expected subagent part"),
        }
    }

    #[test]
    fn text_of_concatenates_only_text_parts() {
        let parts = vec![
            ChatPart::Reasoning {
                text: "thinking".into(),
            },
            ChatPart::Text {
                text: "line one".into(),
            },
            ChatPart::Text {
                text: "line two".into(),
            },
        ];
        assert_eq!(text_of(&parts), "line one\nline two");
    }

    #[test]
    fn strip_verdict_replaces_trailing_text() {
        let parts = vec![
            ChatPart::Reasoning {
                text: "thinking".into(),
            },
            ChatPart::Text {
                text: "review\n```json\n{\"verdict\":\"clean\"}\n```".into(),
            },
        ];
        let stripped = strip_verdict_from_parts(parts, "review");
        assert_eq!(stripped.len(), 2);
        match &stripped[1] {
            ChatPart::Text { text } => assert_eq!(text, "review"),
            _ => panic!("expected trailing text part"),
        }
    }

    #[test]
    fn strip_verdict_drops_text_part_when_stripped_empty() {
        let parts = vec![
            ChatPart::Reasoning {
                text: "thinking".into(),
            },
            ChatPart::Text {
                text: "```json\n{\"verdict\":\"clean\"}\n```".into(),
            },
        ];
        let stripped = strip_verdict_from_parts(parts, "   ");
        assert_eq!(stripped.len(), 1);
        assert!(matches!(stripped[0], ChatPart::Reasoning { .. }));
    }

    #[test]
    fn incremental_chunks_stream_as_appended_deltas() {
        let mut full = String::new();
        let mut streamed = 0;
        assert_eq!(
            accumulate_delta(&mut full, &mut streamed, "Hello "),
            Some(("Hello ".to_string(), 0))
        );
        assert_eq!(
            accumulate_delta(&mut full, &mut streamed, "world"),
            Some(("world".to_string(), 6))
        );
        assert_eq!(full, "Hello world");
    }

    #[test]
    fn cumulative_rebroadcast_streams_only_the_new_tail() {
        let mut full = String::new();
        let mut streamed = 0;
        accumulate_delta(&mut full, &mut streamed, "Hello");
        assert_eq!(
            accumulate_delta(&mut full, &mut streamed, "Hello world"),
            Some((" world".to_string(), 5))
        );
        assert_eq!(full, "Hello world");
    }

    #[test]
    fn empty_or_repeated_chunk_yields_no_delta() {
        let mut full = "abc".to_string();
        let mut streamed = 3;
        assert_eq!(accumulate_delta(&mut full, &mut streamed, "abc"), None);
        assert_eq!(accumulate_delta(&mut full, &mut streamed, ""), None);
    }
}
