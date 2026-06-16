//! Headless ACP review driver. Runs one agent turn over ACP with no human
//! present: auto-approves every permission request, streams the agent's message
//! to the read-only Review pane, and captures the final review text plus a
//! validated verdict (with one-shot self-repair). Shared by the task review loop
//! (`review_loop.rs`), single PR reviews (`pr_review.rs`), and consensus
//! (`pr_consensus.rs`). The live turn is validated via `pnpm desktop:dev`; only
//! the pure helpers below are unit-tested, mirroring `acp_manager.rs`.
//!
//! Everything here is wired up by later tasks (the review callers migrate to this
//! driver next), so the public surface is `#[allow(dead_code)]` for now.
#![allow(dead_code)]

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

use std::path::Path;
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

use super::acp::{acp_provider, content_block_text, permission_option_id_for_kinds};
use super::acp_manager::{build_initialize_request, launch_argv_for_profile};
use super::verdict::{parse_verdict_block, VerdictToken};
use crate::db::Database;
use crate::models::{AgentProfile, PrReviewOutputEvent, ReviewOutputEvent};

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

    // Shared between the notification handler (folds chunks in, streams deltas) and
    // the connection closure (reads the captured text after the turn settles).
    let full: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let streamed: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    // The handler always accumulates into `full` (so the verdict parser sees every
    // turn, including the self-repair turn), but only streams the live delta to the
    // sink while this is true. The repair turn flips it off: its text still lands in
    // `full` to be parsed by offset, but is not shown in the read-only Review pane.
    let streaming: Arc<Mutex<bool>> = Arc::new(Mutex::new(true));

    let note_full = full.clone();
    let note_streamed = streamed.clone();
    let note_streaming = streaming.clone();

    let cwd_owned = cwd.to_path_buf();
    let prompt_owned = prompt.to_string();
    let resume_owned = resume.map(str::to_string);

    let connect_result = Client
        .builder()
        .name("nectus-desktop")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update {
                    let text = content_block_text(&chunk.content);
                    if !text.is_empty() {
                        // Always accumulate so the verdict parser sees the full
                        // turn; only stream to the read-only pane while streaming
                        // is on (the self-repair turn accumulates silently). The
                        // `full`/`streamed` guards are dropped before locking
                        // `streaming`, so no two of these are ever held at once.
                        let delta = {
                            let mut full = note_full.lock().await;
                            let mut streamed = note_streamed.lock().await;
                            accumulate_delta(&mut full, &mut streamed, &text)
                        };
                        if let Some((delta, offset)) = delta {
                            if *note_streaming.lock().await {
                                if let Some(sink) = &sink {
                                    sink.emit(delta, offset as u64);
                                }
                            }
                        }
                    }
                }
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

            let first_text = full.lock().await.clone();
            let (mut verdict, review_text) = parse_verdict_block(&first_text);

            // One-shot self-repair: if the agent didn't emit a parseable verdict
            // block, ask once more for just the block. The repair output is parsed
            // for a verdict but neither streamed nor kept in the review text.
            if verdict.is_none() {
                *streaming.lock().await = false;
                // Start the repair turn from an empty buffer so its reply stands
                // alone; the first turn's prose is already captured in `review_text`.
                // The first prompt's `block_task().await` has returned, so that
                // turn's chunks are all folded in — clearing now can't drop them.
                full.lock().await.clear();
                *streamed.lock().await = 0;
                let repair = vec![ContentBlock::Text(TextContent::new(
                    VERDICT_REPAIR_PROMPT.to_string(),
                ))];
                if cx
                    .send_request(PromptRequest::new(session_id.clone(), repair))
                    .block_task()
                    .await
                    .is_ok()
                {
                    let repair_text = full.lock().await.clone();
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

#[cfg(test)]
mod tests {
    use super::*;

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
