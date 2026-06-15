//! The live ACP session runtime.
//!
//! [`AcpManager`] owns the in-flight ACP chat sessions. Each session spawns the
//! agent CLI over stdio (ACP v0.14) on Tauri's async runtime, runs
//! `initialize` → `session/new`, then loops: it persists+emits the user turn,
//! sends it as `session/prompt`, streams the normalized [`ChatMessageEvent`]
//! snapshots produced by [`super::acp::TurnAccumulator`], and persists the
//! settled agent turn. Each user/agent pair is appended adjacently on this serial
//! loop, so the persisted transcript matches the live order.
//!
//! The pure ACP→part mapping lives in [`super::acp`] and is unit-tested there;
//! this module is the I/O glue around it (builder + closures, `cx.spawn` for
//! deferred permission responses so the dispatch loop never blocks). Live
//! end-to-end behavior is exercised by running the desktop app against a real
//! agent (`pnpm desktop:dev`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol::schema::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use parking_lot::Mutex as DbMutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

use super::acp::{acp_launch, permission_part, TurnAccumulator};
use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, ChatMessage, ChatMessageEvent, ChatPart, ChatRole, ChatSession, Repo,
    TaskSummary,
};

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Whether `name` is a valid POSIX env-var identifier. `AcpAgent::from_args`
/// treats a leading argv token as an env assignment only if its name matches
/// this shape and otherwise stops env parsing and takes the token as the command
/// — so a login-shell pair with a non-identifier key (e.g. a `BASH_FUNC_x%%`
/// export) must be dropped before it corrupts the spawned argv.
fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A pending permission map: our request id → the channel that delivers the
/// user's chosen option id (or `None` to cancel).
type PendingPermissions = Arc<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>>;
type SessionMap = Arc<Mutex<HashMap<String, AcpSessionHandle>>>;

/// Cheap to clone (only an `Arc`): a clone shares the same live-session map, so a
/// command handler can hold a handle without locking the whole manager.
#[derive(Clone, Default)]
pub struct AcpManager {
    sessions: SessionMap,
}

struct AcpSessionHandle {
    prompt_tx: mpsc::UnboundedSender<String>,
    permissions: PendingPermissions,
    /// Aborting this drops the connection future, which drops the agent's
    /// `ChildGuard` and kills the child — the only way to stop a session that is
    /// mid-turn or parked on a pending permission.
    abort: JoinHandle<()>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start an ACP chat session for a task. If a live session already exists for
    /// the task it is reused (no duplicate agent process). Creates the session
    /// row, spawns the agent connection on Tauri's runtime, and returns the
    /// persisted session.
    pub async fn start(
        &self,
        app: AppHandle,
        db: Arc<DbMutex<Database>>,
        task: TaskSummary,
        repo: Repo,
        agent: AgentProfile,
    ) -> Result<ChatSession, String> {
        let launch = acp_launch(agent.agent_kind)
            .ok_or_else(|| format!("{} does not support ACP chat", agent.name))?;

        // Reuse an already-live session for this task rather than spawning a
        // second agent (guards against double-start / double-click).
        let existing = db.lock().latest_chat_session(task.id)?;
        if let Some(existing) = existing {
            if self.sessions.lock().await.contains_key(&existing.id) {
                return Ok(existing);
            }
        }

        let cwd = task
            .worktree_path
            .clone()
            .unwrap_or_else(|| repo.path.clone());
        let chat_session = db
            .lock()
            .create_chat_session(task.id, Some(agent.id), &cwd)?;
        let chat_session_id = chat_session.id.clone();

        let (prompt_tx, prompt_rx) = mpsc::unbounded_channel::<String>();
        let permissions: PendingPermissions = Arc::new(Mutex::new(HashMap::new()));

        // Build the ACP argv as discrete tokens for `AcpAgent::from_args` (no
        // shell re-split): leading `NAME=value` tokens become the child env, then
        // the resolved binary, then its args. This satisfies all three halves of
        // the macOS GUI-spawn rule (CLAUDE.md → Spawning External CLIs): the
        // binary is resolved to an absolute path; `PATH` is the augmented path so
        // nested `node` execs (else `env: node: No such file or directory`, exit
        // 127); and the login-shell env is seeded so provider keys
        // (ANTHROPIC_API_KEY/OPENAI_API_KEY, HOME, …) reach the agent from a
        // Finder-launched .app (else "API key is missing"). `PATH` is appended
        // after the login env (which excludes it) so the augmented one wins.
        let path_env = crate::process_util::augmented_path()
            .to_string_lossy()
            .into_owned();
        let resolved = crate::process_util::resolve_executable(&launch.command)
            .to_string_lossy()
            .into_owned();
        let mut argv: Vec<String> = crate::process_util::login_shell_environment()
            .into_iter()
            .filter(|(key, value)| is_env_name(key) && !value.contains('\n'))
            .map(|(key, value)| format!("{key}={value}"))
            .collect();
        argv.push(format!("PATH={path_env}"));
        // Upstream workaround: @anthropic-ai/claude-agent-sdk extracts and spawns
        // its *bundled* Bun-compiled `claude`, which fails to exec on macOS with
        // "spawn Unknown system error -88" (EBADMACHO). The adapter honors
        // CLAUDE_CODE_EXECUTABLE, so point it at the user's installed `claude`.
        // Drop this once the bundled binary execs cleanly.
        if matches!(agent.agent_kind, AgentKind::Claude) {
            let claude = crate::process_util::resolve_executable("claude")
                .to_string_lossy()
                .into_owned();
            argv.push(format!("CLAUDE_CODE_EXECUTABLE={claude}"));
        }
        argv.push(resolved);
        argv.extend(launch.args);

        let abort = tauri::async_runtime::spawn(run_connection(Connection {
            app,
            db,
            task_id: task.id,
            chat_session_id: chat_session_id.clone(),
            cwd,
            argv,
            permissions: permissions.clone(),
            prompt_rx,
            sessions: self.sessions.clone(),
        }));

        self.sessions.lock().await.insert(
            chat_session_id,
            AcpSessionHandle {
                prompt_tx,
                permissions,
                abort,
            },
        );

        Ok(chat_session)
    }

    /// Queue a prompt to a running session. The connection loop persists+emits
    /// the user turn, sends it as `session/prompt`, and streams the response.
    pub async fn prompt(&self, session_id: &str, text: String) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        handle
            .prompt_tx
            .send(text)
            .map_err(|_| "Chat session has ended".to_string())
    }

    /// Answer a pending permission request. `option_id` is the chosen option, or
    /// `None` to cancel.
    pub async fn respond_permission(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        let sender = handle
            .permissions
            .lock()
            .await
            .remove(request_id)
            .ok_or_else(|| "No pending permission request".to_string())?;
        sender
            .send(option_id)
            .map_err(|_| "Permission request already resolved".to_string())
    }

    /// Stop a session: abort the connection task (which kills the agent child),
    /// even if it is mid-turn or parked on a pending permission.
    pub async fn stop(&self, session_id: &str) -> Result<(), String> {
        if let Some(handle) = self.sessions.lock().await.remove(session_id) {
            handle.abort.abort();
        }
        Ok(())
    }

    /// Abort every live session — called from the window-close handler so agent
    /// children don't outlive the app. Synchronous (the close handler is sync);
    /// safe only outside an async context.
    pub fn stop_all_blocking(&self) {
        let mut sessions = self.sessions.blocking_lock();
        for (_, handle) in sessions.drain() {
            handle.abort.abort();
        }
    }
}

/// Everything the spawned connection task owns.
struct Connection {
    app: AppHandle,
    db: Arc<DbMutex<Database>>,
    task_id: i64,
    chat_session_id: String,
    cwd: String,
    argv: Vec<String>,
    permissions: PendingPermissions,
    prompt_rx: mpsc::UnboundedReceiver<String>,
    sessions: SessionMap,
}

async fn run_connection(connection: Connection) {
    let Connection {
        app,
        db,
        task_id,
        chat_session_id,
        cwd,
        argv,
        permissions,
        mut prompt_rx,
        sessions,
    } = connection;

    let transport = match AcpAgent::from_args(argv) {
        Ok(transport) => transport,
        Err(error) => {
            emit_error(
                &app,
                &chat_session_id,
                task_id,
                &format!("Failed to launch agent: {error}"),
            );
            sessions.lock().await.remove(&chat_session_id);
            return;
        }
    };

    // The accumulator for the in-flight turn, shared between the notification
    // handler (which folds updates in) and the prompt loop (which opens/closes it).
    let current: Arc<Mutex<Option<TurnAccumulator>>> = Arc::new(Mutex::new(None));

    // Per-handler clones (the builder stores the closures; the prompt loop keeps
    // the originals).
    let note_app = app.clone();
    let note_session = chat_session_id.clone();
    let note_current = current.clone();
    let perm_app = app.clone();
    let perm_db = db.clone();
    let perm_session = chat_session_id.clone();
    let outer_app = app.clone();
    let outer_session = chat_session_id.clone();

    let connect_result = Client
        .builder()
        .name("nectus-desktop")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let Some(accumulator) = note_current.lock().await.as_mut() {
                    accumulator.apply(&notification.update);
                    let message = accumulator.snapshot(None);
                    let _ = note_app.emit(
                        "session_chat",
                        ChatMessageEvent {
                            session_id: note_session.clone(),
                            task_id,
                            message,
                            done: false,
                        },
                    );
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, cx| {
                let request_id = Uuid::new_v4().to_string();
                let message = ChatMessage {
                    id: format!("perm-{request_id}"),
                    role: ChatRole::Agent,
                    parts: vec![permission_part(&request_id, &request)],
                    created_at: now(),
                    completed_at: None,
                };
                let _ = perm_app.emit(
                    "session_chat",
                    ChatMessageEvent {
                        session_id: perm_session.clone(),
                        task_id,
                        message,
                        done: false,
                    },
                );
                let (sender, receiver) = oneshot::channel::<Option<String>>();
                permissions.lock().await.insert(request_id.clone(), sender);
                // FnMut closure: clone per-call for the spawned task (can't move
                // captured state out across calls).
                let db = perm_db.clone();
                let app = perm_app.clone();
                let session = perm_session.clone();
                // Defer the response: awaiting the user's choice here would stall
                // the dispatch loop. cx.spawn keeps the loop processing updates.
                cx.spawn(async move {
                    let choice = receiver.await.ok().flatten();
                    // Resolve the live permission card to a settled note (same id,
                    // so the frontend upsert replaces it and a refetch keeps it).
                    let resolved_text = match &choice {
                        Some(option_id) => {
                            let label = request
                                .options
                                .iter()
                                .find(|option| option.option_id.0.to_string() == *option_id)
                                .map(|option| option.name.clone())
                                .unwrap_or_else(|| option_id.clone());
                            format!("✓ Permission granted: {label}")
                        }
                        None => "✗ Permission denied".to_string(),
                    };
                    let resolved = ChatMessage {
                        id: format!("perm-{request_id}"),
                        role: ChatRole::Agent,
                        parts: vec![ChatPart::Text {
                            text: resolved_text,
                        }],
                        created_at: now(),
                        completed_at: Some(now()),
                    };
                    persist_and_emit(&db, &app, &session, task_id, &resolved);
                    let outcome = match choice {
                        Some(option_id) => RequestPermissionOutcome::Selected(
                            SelectedPermissionOutcome::new(option_id),
                        ),
                        None => RequestPermissionOutcome::Cancelled,
                    };
                    // A failed respond only means the connection is already gone;
                    // don't escalate it into a fatal task error.
                    let _ = responder.respond(RequestPermissionResponse::new(outcome));
                    Ok(())
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, move |cx: ConnectionTo<Agent>| async move {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let new_session = cx
                .send_request(NewSessionRequest::new(PathBuf::from(&cwd)))
                .block_task()
                .await?;
            let acp_session_id = new_session.session_id;
            if let Err(error) = db
                .lock()
                .set_chat_acp_session_id(&chat_session_id, &acp_session_id.to_string())
            {
                tracing::warn!(?error, chat_session_id, "failed to persist acp session id");
            }

            while let Some(prompt_text) = prompt_rx.recv().await {
                // Persist + emit the user turn on the serial loop so each
                // user/agent pair lands adjacently and in order.
                let user_message = ChatMessage {
                    id: format!("user-{}", Uuid::new_v4()),
                    role: ChatRole::User,
                    parts: vec![ChatPart::Text {
                        text: prompt_text.clone(),
                    }],
                    created_at: now(),
                    completed_at: Some(now()),
                };
                persist_and_emit(&db, &app, &chat_session_id, task_id, &user_message);

                *current.lock().await =
                    Some(TurnAccumulator::new(Uuid::new_v4().to_string(), now()));
                let prompt_result = cx
                    .send_request(PromptRequest::new(
                        acp_session_id.clone(),
                        vec![ContentBlock::Text(TextContent::new(prompt_text))],
                    ))
                    .block_task()
                    .await;
                // Skip empty turns (e.g. a prompt that errored before any chunk)
                // so they neither persist an empty bubble nor emit a blank reply.
                let settled = current
                    .lock()
                    .await
                    .take()
                    .filter(|accumulator| !accumulator.is_empty())
                    .map(|accumulator| accumulator.snapshot(Some(now())));
                if let Some(message) = settled {
                    persist_and_emit(&db, &app, &chat_session_id, task_id, &message);
                }
                if let Err(error) = prompt_result {
                    emit_error(
                        &app,
                        &chat_session_id,
                        task_id,
                        &format!("Prompt failed: {error}"),
                    );
                }
            }
            Ok(())
        })
        .await;

    if let Err(error) = connect_result {
        emit_error(
            &outer_app,
            &outer_session,
            task_id,
            &format!("ACP connection error: {error}"),
        );
    }
    // The connection ended (loop drained, or error): drop our own handle so the
    // map doesn't accumulate dead sessions. `chat_session_id` was moved into the
    // connect_with closure, so use the outer clone. (A bare `remove` detaches this
    // task's own JoinHandle; it does not abort the running task.)
    sessions.lock().await.remove(&outer_session);
}

/// Persist a settled message (logging — not swallowing — a failure, like the
/// sibling session modules) and emit it to the UI as `done: true`.
fn persist_and_emit(
    db: &Arc<DbMutex<Database>>,
    app: &AppHandle,
    session_id: &str,
    task_id: i64,
    message: &ChatMessage,
) {
    if let Err(error) = db.lock().append_chat_message(session_id, task_id, message) {
        tracing::warn!(
            ?error,
            session_id,
            task_id,
            "failed to persist chat message"
        );
    }
    let _ = app.emit(
        "session_chat",
        ChatMessageEvent {
            session_id: session_id.to_string(),
            task_id,
            message: message.clone(),
            done: true,
        },
    );
}

/// Surface a connection-level error to the UI as a settled agent text message.
fn emit_error(app: &AppHandle, session_id: &str, task_id: i64, message: &str) {
    let _ = app.emit(
        "session_chat",
        ChatMessageEvent {
            session_id: session_id.to_string(),
            task_id,
            message: ChatMessage {
                id: format!("error-{}", Uuid::new_v4()),
                role: ChatRole::Agent,
                parts: vec![ChatPart::Text {
                    text: format!("⚠️ {message}"),
                }],
                created_at: now(),
                completed_at: Some(now()),
            },
            done: true,
        },
    );
}
