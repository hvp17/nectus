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

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol::schema::{
    AgentCapabilities, ContentBlock, InitializeRequest, LoadSessionRequest, NewSessionRequest,
    PromptRequest, ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
    TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use parking_lot::Mutex as DbMutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

use super::acp::{acp_provider, permission_part, AcpLaunch, TurnAccumulator};
use crate::db::Database;
use crate::models::{
    AgentProfile, ChatMessage, ChatMessageEvent, ChatPart, ChatRole, ChatSession, Repo, TaskSummary,
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

fn env_assignment(key: &str, value: &str) -> Option<String> {
    if is_env_name(key) && !value.contains('\n') {
        Some(format!("{key}={value}"))
    } else {
        None
    }
}

fn build_acp_argv(
    launch: &AcpLaunch,
    path_env: String,
    resolved_command: String,
    login_env: impl IntoIterator<Item = (String, String)>,
    provider_env: impl IntoIterator<Item = (String, String)>,
    profile_env: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut argv: Vec<String> = login_env
        .into_iter()
        .filter_map(|(key, value)| env_assignment(&key, &value))
        .collect();
    argv.push(format!("PATH={path_env}"));
    argv.extend(
        provider_env
            .into_iter()
            .filter_map(|(key, value)| env_assignment(&key, &value)),
    );
    argv.extend(
        profile_env
            .iter()
            .filter_map(|(key, value)| env_assignment(key, value)),
    );
    argv.push(resolved_command);
    argv.extend(launch.args.iter().cloned());
    argv
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
    /// the task it is reused (no duplicate agent process). If the latest persisted
    /// session belongs to the same profile and has an ACP session id, the spawned
    /// connection attempts `session/load`; otherwise it creates a new chat row and
    /// uses `session/new`.
    pub async fn start(
        &self,
        app: AppHandle,
        db: Arc<DbMutex<Database>>,
        task: TaskSummary,
        repo: Repo,
        agent: AgentProfile,
    ) -> Result<ChatSession, String> {
        let provider = acp_provider(agent.agent_kind)
            .ok_or_else(|| format!("{} does not support ACP chat", agent.name))?;

        // Reuse an already-live session for this task/profile rather than
        // spawning a second agent (guards against double-start / double-click).
        let existing = db
            .lock()
            .latest_chat_session_for_profile(task.id, agent.id)?;
        if let Some(existing) = &existing {
            if self.sessions.lock().await.contains_key(&existing.id) {
                return Ok(existing.clone());
            }
        }

        let cwd = task
            .worktree_path
            .clone()
            .unwrap_or_else(|| repo.path.clone());
        let chat_session = existing
            .filter(|session| {
                session.agent_profile_id == Some(agent.id) && session.acp_session_id.is_some()
            })
            .map(Ok)
            .unwrap_or_else(|| db.lock().create_chat_session(task.id, Some(agent.id), &cwd))?;
        let chat_session_id = chat_session.id.clone();
        let resume_acp_session_id = chat_session.acp_session_id.clone();

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
        // Finder-launched .app (else "API key is missing"). The selected profile's
        // env is appended last so profile-specific keys/PATH still win.
        let path_env = crate::process_util::augmented_path()
            .to_string_lossy()
            .into_owned();
        let resolved = crate::process_util::resolve_executable(&provider.launch.command)
            .to_string_lossy()
            .into_owned();
        let provider_env = provider.executable_env.into_iter().map(|executable| {
            (
                executable.var.to_string(),
                crate::process_util::resolve_executable(executable.command)
                    .to_string_lossy()
                    .into_owned(),
            )
        });
        let argv = build_acp_argv(
            &provider.launch,
            path_env,
            resolved,
            crate::process_util::login_shell_environment(),
            provider_env,
            &agent.env,
        );

        let abort = tauri::async_runtime::spawn(run_connection(Connection {
            app,
            db,
            task_id: task.id,
            agent_profile_id: Some(agent.id),
            chat_session_id: chat_session_id.clone(),
            cwd,
            resume_acp_session_id,
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
    agent_profile_id: Option<i64>,
    chat_session_id: String,
    cwd: String,
    resume_acp_session_id: Option<String>,
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
        agent_profile_id,
        chat_session_id,
        cwd,
        resume_acp_session_id,
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
                agent_profile_id,
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
    let note_profile_id = agent_profile_id;
    let note_current = current.clone();
    let perm_app = app.clone();
    let perm_db = db.clone();
    let perm_session = chat_session_id.clone();
    let perm_profile_id = agent_profile_id;
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
                            agent_profile_id: note_profile_id,
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
                        agent_profile_id: perm_profile_id,
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
                let profile_id = perm_profile_id;
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
                    persist_and_emit(&db, &app, &session, task_id, profile_id, &resolved);
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
            let initialize = cx
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let acp_session_id = match session_start_request(
                &cwd,
                resume_acp_session_id.as_deref(),
                &initialize.agent_capabilities,
            ) {
                AcpSessionStartRequest::Load { session_id, cwd } => {
                    tracing::info!(chat_session_id, acp_session_id = %session_id, "loading ACP session");
                    cx.send_request(LoadSessionRequest::new(session_id.clone(), cwd))
                        .block_task()
                        .await?;
                    session_id
                }
                AcpSessionStartRequest::New { cwd } => {
                    let new_session = cx
                        .send_request(NewSessionRequest::new(cwd))
                        .block_task()
                        .await?;
                    let acp_session_id = new_session.session_id;
                    if let Err(error) = db
                        .lock()
                        .set_chat_acp_session_id(&chat_session_id, &acp_session_id.to_string())
                    {
                        tracing::warn!(?error, chat_session_id, "failed to persist acp session id");
                    }
                    acp_session_id
                }
            };

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
                persist_and_emit(
                    &db,
                    &app,
                    &chat_session_id,
                    task_id,
                    agent_profile_id,
                    &user_message,
                );

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
                    persist_and_emit(
                        &db,
                        &app,
                        &chat_session_id,
                        task_id,
                        agent_profile_id,
                        &message,
                    );
                }
                if let Err(error) = prompt_result {
                    emit_error(
                        &app,
                        &chat_session_id,
                        task_id,
                        agent_profile_id,
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
            agent_profile_id,
            &format!("ACP connection error: {error}"),
        );
    }
    // The connection ended (loop drained, or error): drop our own handle so the
    // map doesn't accumulate dead sessions. `chat_session_id` was moved into the
    // connect_with closure, so use the outer clone. (A bare `remove` detaches this
    // task's own JoinHandle; it does not abort the running task.)
    sessions.lock().await.remove(&outer_session);
}

#[derive(Debug, PartialEq, Eq)]
enum AcpSessionStartRequest {
    New { cwd: PathBuf },
    Load { session_id: SessionId, cwd: PathBuf },
}

fn session_start_request(
    cwd: &str,
    resume_acp_session_id: Option<&str>,
    agent_capabilities: &AgentCapabilities,
) -> AcpSessionStartRequest {
    match resume_acp_session_id {
        Some(session_id) if agent_capabilities.load_session => AcpSessionStartRequest::Load {
            session_id: SessionId::new(session_id),
            cwd: PathBuf::from(cwd),
        },
        _ => AcpSessionStartRequest::New {
            cwd: PathBuf::from(cwd),
        },
    }
}

/// Persist a settled message (logging — not swallowing — a failure, like the
/// sibling session modules) and emit it to the UI as `done: true`.
fn persist_and_emit(
    db: &Arc<DbMutex<Database>>,
    app: &AppHandle,
    session_id: &str,
    task_id: i64,
    agent_profile_id: Option<i64>,
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
            agent_profile_id,
            message: message.clone(),
            done: true,
        },
    );
}

/// Surface a connection-level error to the UI as a settled agent text message.
fn emit_error(
    app: &AppHandle,
    session_id: &str,
    task_id: i64,
    agent_profile_id: Option<i64>,
    message: &str,
) {
    let _ = app.emit(
        "session_chat",
        ChatMessageEvent {
            session_id: session_id.to_string(),
            task_id,
            agent_profile_id,
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

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{AgentCapabilities, SessionId};
    use std::collections::BTreeMap;

    #[test]
    fn start_request_loads_existing_session_only_when_agent_advertises_support() {
        let cwd = "/tmp/worktree";
        let load_capable = AgentCapabilities::new().load_session(true);
        let not_load_capable = AgentCapabilities::new();

        assert!(matches!(
            session_start_request(cwd, Some("acp-123"), &load_capable),
            AcpSessionStartRequest::Load {
                session_id,
                cwd: request_cwd
            } if session_id == SessionId::new("acp-123")
                && request_cwd.as_path() == std::path::Path::new(cwd)
        ));
        assert!(matches!(
            session_start_request(cwd, Some("acp-123"), &not_load_capable),
            AcpSessionStartRequest::New { cwd: request_cwd }
                if request_cwd.as_path() == std::path::Path::new(cwd)
        ));
        assert!(matches!(
            session_start_request(cwd, None, &load_capable),
            AcpSessionStartRequest::New { cwd: request_cwd }
                if request_cwd.as_path() == std::path::Path::new(cwd)
        ));
    }

    #[test]
    fn acp_argv_applies_profile_env_after_login_path_and_provider_env() {
        let launch = super::super::acp::AcpLaunch {
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@agent/adapter".to_string()],
        };
        let profile_env = BTreeMap::from([
            ("ANTHROPIC_API_KEY".to_string(), "profile-key".to_string()),
            (
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/custom/claude".to_string(),
            ),
            ("PATH".to_string(), "/profile/bin".to_string()),
            ("BAD-NAME".to_string(), "ignored".to_string()),
            ("MULTILINE".to_string(), "ignored\nvalue".to_string()),
        ]);

        let argv = build_acp_argv(
            &launch,
            "/augmented/bin".to_string(),
            "/resolved/npx".to_string(),
            vec![
                ("ANTHROPIC_API_KEY".to_string(), "login-key".to_string()),
                ("BASH_FUNC_bad%%".to_string(), "ignored".to_string()),
            ],
            vec![(
                "CLAUDE_CODE_EXECUTABLE".to_string(),
                "/resolved/claude".to_string(),
            )],
            &profile_env,
        );

        assert_eq!(
            argv,
            vec![
                "ANTHROPIC_API_KEY=login-key",
                "PATH=/augmented/bin",
                "CLAUDE_CODE_EXECUTABLE=/resolved/claude",
                "ANTHROPIC_API_KEY=profile-key",
                "CLAUDE_CODE_EXECUTABLE=/custom/claude",
                "PATH=/profile/bin",
                "/resolved/npx",
                "-y",
                "@agent/adapter",
            ]
        );
    }
}
