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
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::schema::{
    AgentCapabilities, AvailableCommand, AvailableCommandInput, AvailableCommandsUpdate,
    CancelNotification, ConfigOptionUpdate, ContentBlock, CurrentModeUpdate, EmbeddedResource,
    EmbeddedResourceResource, ImageContent, Implementation, InitializeRequest, InitializeResponse,
    LoadSessionRequest, McpServer, NewSessionRequest, PermissionOptionKind, PromptRequest,
    ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    ResourceLink, SelectedPermissionOutcome, SessionConfigKind, SessionConfigOption,
    SessionConfigSelectOptions, SessionId, SessionInfoUpdate, SessionMode, SessionModeState,
    SessionNotification, SessionUpdate, SetSessionConfigOptionRequest, SetSessionModeRequest,
    TextContent, TextResourceContents,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use parking_lot::Mutex as DbMutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

use super::acp::{
    acp_provider, permission_option_id_for_kinds, permission_option_kind_for_id, permission_part,
    permission_request_title, AcpLaunch, TurnAccumulator,
};
use crate::db::Database;
use crate::git_ops;
use crate::models::{
    AgentProfile, ChatAuthMethod, ChatAvailableCommand, ChatConfigOption, ChatConfigSelectOption,
    ChatImageAttachment, ChatImplementation, ChatMcpCapabilities, ChatMessage, ChatMessageEvent,
    ChatPart, ChatPermissionPolicyKind, ChatPromptCapabilities, ChatRole, ChatRuntimeCapabilities,
    ChatSession, ChatSessionExitedEvent, ChatSessionMode, ChatSessionRuntime,
    ChatSessionRuntimeEvent, ChatUsageEvent, Repo, TaskSummary,
};

/// A queued user prompt (text plus optional image blocks).
#[derive(Debug, Clone)]
struct PromptPayload {
    text: String,
    images: Vec<ChatImageAttachment>,
}

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

/// Resolve a provider's ACP launch into the `AcpAgent::from_args` token list:
/// login-shell env assignments, the augmented PATH, provider executable-path env,
/// the resolved binary, then its launch args. Shared by chat (`AcpManager::start`)
/// and headless reviews (`review_runtime`). See CLAUDE.md → Spawning External CLIs.
pub(super) fn launch_argv_for_profile(
    provider: &super::acp::AcpProviderDescriptor,
    profile_env: &BTreeMap<String, String>,
) -> Vec<String> {
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
    build_acp_argv(
        &provider.launch,
        path_env,
        resolved,
        crate::process_util::login_shell_environment(),
        provider_env,
        profile_env,
    )
}

/// A pending permission map: our request id → the channel that delivers the
/// user's chosen option id (or `None` to cancel).
type PendingPermissions = Arc<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>>;
type SessionMap = Arc<Mutex<HashMap<String, AcpSessionHandle>>>;

#[derive(Debug, Clone)]
enum AcpControlMessage {
    CancelPrompt,
    SetMode(String),
    SetConfig { config_id: String, value_id: String },
}

/// Cheap to clone (only an `Arc`): a clone shares the same live-session map, so a
/// command handler can hold a handle without locking the whole manager.
#[derive(Clone, Default)]
pub struct AcpManager {
    sessions: SessionMap,
}

struct AcpSessionHandle {
    prompt_tx: mpsc::UnboundedSender<PromptPayload>,
    control_tx: mpsc::UnboundedSender<AcpControlMessage>,
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

        let setup = session_setup_for_task(&task, &repo, &agent)?;
        let cwd = setup.cwd.to_string_lossy().to_string();
        let chat_session = existing
            .filter(|session| {
                session.agent_profile_id == Some(agent.id) && session.acp_session_id.is_some()
            })
            .map(Ok)
            .unwrap_or_else(|| db.lock().create_chat_session(task.id, Some(agent.id), &cwd))?;
        let chat_session_id = chat_session.id.clone();
        let resume_acp_session_id = chat_session.acp_session_id.clone();
        let task_id = task.id;
        let agent_profile_id = Some(agent.id);

        let (prompt_tx, prompt_rx) = mpsc::unbounded_channel::<PromptPayload>();
        let (control_tx, control_rx) = mpsc::unbounded_channel::<AcpControlMessage>();
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
        let argv = launch_argv_for_profile(&provider, &agent.env);

        let abort = tauri::async_runtime::spawn(run_connection(Connection {
            app,
            db,
            task_id,
            agent_profile_id,
            chat_session_id: chat_session_id.clone(),
            task,
            repo,
            setup,
            resume_acp_session_id,
            argv,
            permissions: permissions.clone(),
            prompt_rx,
            control_rx,
            sessions: self.sessions.clone(),
        }));

        self.sessions.lock().await.insert(
            chat_session_id,
            AcpSessionHandle {
                prompt_tx,
                control_tx,
                permissions,
                abort,
            },
        );

        Ok(chat_session)
    }

    /// Queue a prompt to a running ACP chat. The connection loop persists+emits
    /// the user turn, sends it as `session/prompt`, and streams the response.
    pub async fn prompt(
        &self,
        session_id: &str,
        text: String,
        images: Vec<ChatImageAttachment>,
    ) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        handle
            .prompt_tx
            .send(PromptPayload { text, images })
            .map_err(|_| "Chat session has ended".to_string())
    }

    /// Gracefully cancel the active ACP turn. The process stays alive so the
    /// persisted ACP session id can still be resumed or prompted again.
    pub async fn cancel_prompt(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        handle
            .control_tx
            .send(AcpControlMessage::CancelPrompt)
            .map_err(|_| "Chat session has ended".to_string())
    }

    /// Ask the live ACP agent to switch session mode.
    pub async fn set_mode(&self, session_id: &str, mode_id: String) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        handle
            .control_tx
            .send(AcpControlMessage::SetMode(mode_id))
            .map_err(|_| "Chat session has ended".to_string())
    }

    /// Ask the live ACP agent to update a select-style config option.
    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: String,
        value_id: String,
    ) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "No such chat session".to_string())?;
        handle
            .control_tx
            .send(AcpControlMessage::SetConfig {
                config_id,
                value_id,
            })
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
    task: TaskSummary,
    repo: Repo,
    setup: AcpSessionSetup,
    resume_acp_session_id: Option<String>,
    argv: Vec<String>,
    permissions: PendingPermissions,
    prompt_rx: mpsc::UnboundedReceiver<PromptPayload>,
    control_rx: mpsc::UnboundedReceiver<AcpControlMessage>,
    sessions: SessionMap,
}

async fn run_connection(connection: Connection) {
    let Connection {
        app,
        db,
        task_id,
        agent_profile_id,
        chat_session_id,
        task,
        repo,
        setup,
        resume_acp_session_id,
        argv,
        permissions,
        mut prompt_rx,
        mut control_rx,
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
            emit_chat_session_exited(&app, &chat_session_id, task_id, agent_profile_id);
            sessions.lock().await.remove(&chat_session_id);
            return;
        }
    };

    // The accumulator for the in-flight turn, shared between the notification
    // handler (which folds updates in) and the prompt loop (which opens/closes it).
    let current: Arc<Mutex<Option<TurnAccumulator>>> = Arc::new(Mutex::new(None));
    let runtime_state: Arc<Mutex<ChatSessionRuntime>> =
        Arc::new(Mutex::new(ChatSessionRuntime::default()));

    // Per-handler clones (the builder stores the closures; the prompt loop keeps
    // the originals).
    let note_app = app.clone();
    let note_db = db.clone();
    let note_session = chat_session_id.clone();
    let note_profile_id = agent_profile_id;
    let note_current = current.clone();
    let note_runtime = runtime_state.clone();
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
                if let SessionUpdate::UsageUpdate(usage) = &notification.update {
                    let _ = note_app.emit(
                        "session_chat_usage",
                        ChatUsageEvent {
                            session_id: note_session.clone(),
                            task_id,
                            agent_profile_id: note_profile_id,
                            used: usage.used,
                            size: usage.size,
                        },
                    );
                    return Ok(());
                }
                if is_runtime_update(&notification.update) {
                    let runtime = {
                        let mut runtime = note_runtime.lock().await;
                        apply_runtime_update(&mut runtime, &notification.update);
                        runtime.clone()
                    };
                    persist_emit_runtime(
                        &note_db,
                        &note_app,
                        &note_session,
                        task_id,
                        note_profile_id,
                        &runtime,
                    );
                    return Ok(());
                }
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
                let perm_message_id = format!("perm-{request_id}");
                let tool_title = permission_request_title(&request);
                let auto_option_id = {
                    let guard = perm_db.lock();
                    match guard.chat_permission_policy(&tool_title).ok().flatten() {
                        Some(ChatPermissionPolicyKind::AllowAlways) => {
                            permission_option_id_for_kinds(
                                &request,
                                &[
                                    PermissionOptionKind::AllowAlways,
                                    PermissionOptionKind::AllowOnce,
                                ],
                            )
                        }
                        Some(ChatPermissionPolicyKind::RejectAlways) => {
                            permission_option_id_for_kinds(
                                &request,
                                &[
                                    PermissionOptionKind::RejectAlways,
                                    PermissionOptionKind::RejectOnce,
                                ],
                            )
                        }
                        None => None,
                    }
                };

                if let Some(option_id) = auto_option_id {
                    let resolved = resolved_permission_message(
                        Some(&option_id),
                        &request,
                        &perm_message_id,
                    );
                    persist_and_emit(
                        &perm_db,
                        &perm_app,
                        &perm_session,
                        task_id,
                        perm_profile_id,
                        &resolved,
                    );
                    let outcome = RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option_id),
                    );
                    let _ = responder.respond(RequestPermissionResponse::new(outcome));
                    return Ok(());
                }

                let message = ChatMessage {
                    id: perm_message_id.clone(),
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
                let db = perm_db.clone();
                let app = perm_app.clone();
                let session = perm_session.clone();
                let profile_id = perm_profile_id;
                let tool_title = tool_title.clone();
                let perm_message_id = perm_message_id.clone();
                cx.spawn(async move {
                    let choice = receiver.await.ok().flatten();
                    if let Some(ref option_id) = choice {
                        if let Some(kind) = permission_option_kind_for_id(&request, option_id) {
                            use crate::models::ChatPermissionKind;
                            let policy = match kind {
                                ChatPermissionKind::AllowAlways => {
                                    Some(ChatPermissionPolicyKind::AllowAlways)
                                }
                                ChatPermissionKind::RejectAlways => {
                                    Some(ChatPermissionPolicyKind::RejectAlways)
                                }
                                _ => None,
                            };
                            if let Some(policy) = policy {
                                if let Err(error) =
                                    db.lock().remember_chat_permission_policy(&tool_title, policy)
                                {
                                    tracing::warn!(?error, tool_title, "failed to save permission policy");
                                }
                            }
                        }
                    }
                    let resolved = resolved_permission_message(
                        choice.as_deref(),
                        &request,
                        &perm_message_id,
                    );
                    persist_and_emit(&db, &app, &session, task_id, profile_id, &resolved);
                    let outcome = match choice {
                        Some(option_id) => RequestPermissionOutcome::Selected(
                            SelectedPermissionOutcome::new(option_id),
                        ),
                        None => RequestPermissionOutcome::Cancelled,
                    };
                    let _ = responder.respond(RequestPermissionResponse::new(outcome));
                    Ok(())
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, move |cx: ConnectionTo<Agent>| async move {
            let initialize = cx.send_request(build_initialize_request()).block_task().await?;
            let initial_runtime = runtime_from_initialize_response(&initialize);
            {
                *runtime_state.lock().await = initial_runtime.clone();
            }
            persist_emit_runtime(
                &db,
                &app,
                &chat_session_id,
                task_id,
                agent_profile_id,
                &initial_runtime,
            );

            let acp_session_id = match session_start_request(
                setup.clone(),
                resume_acp_session_id.as_deref(),
                &initialize.agent_capabilities,
            ) {
                AcpSessionStartRequest::Load { session_id, setup } => {
                    tracing::info!(chat_session_id, acp_session_id = %session_id, "loading ACP session");
                    let response = cx
                        .send_request(
                            LoadSessionRequest::new(session_id.clone(), setup.cwd)
                                .additional_directories(setup.additional_directories)
                                .mcp_servers(setup.mcp_servers),
                        )
                        .block_task()
                        .await?;
                    let runtime = {
                        let mut runtime = runtime_state.lock().await;
                        apply_session_mode_state(&mut runtime, response.modes.as_ref());
                        apply_session_config_options(&mut runtime, response.config_options.as_ref());
                        runtime.clone()
                    };
                    persist_emit_runtime(
                        &db,
                        &app,
                        &chat_session_id,
                        task_id,
                        agent_profile_id,
                        &runtime,
                    );
                    session_id
                }
                AcpSessionStartRequest::New { setup } => {
                    let new_session = cx
                        .send_request(
                            NewSessionRequest::new(setup.cwd)
                                .additional_directories(setup.additional_directories)
                                .mcp_servers(setup.mcp_servers),
                        )
                        .block_task()
                        .await?;
                    let acp_session_id = new_session.session_id;
                    let runtime = {
                        let mut runtime = runtime_state.lock().await;
                        apply_session_mode_state(&mut runtime, new_session.modes.as_ref());
                        apply_session_config_options(
                            &mut runtime,
                            new_session.config_options.as_ref(),
                        );
                        runtime.clone()
                    };
                    persist_emit_runtime(
                        &db,
                        &app,
                        &chat_session_id,
                        task_id,
                        agent_profile_id,
                        &runtime,
                    );
                    if let Err(error) = db
                        .lock()
                        .set_chat_acp_session_id(&chat_session_id, &acp_session_id.to_string())
                    {
                        tracing::warn!(?error, chat_session_id, "failed to persist acp session id");
                    }
                    acp_session_id
                }
            };

            let cwd_for_checkpoint = setup.cwd.to_string_lossy().to_string();

            loop {
                tokio::select! {
                    Some(prompt_payload) = prompt_rx.recv() => {
                let prompt_text = prompt_payload.text;
                let prompt_images = prompt_payload.images;
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
                let runtime = runtime_state.lock().await.clone();
                let content_blocks = prompt_content_blocks(
                    prompt_text,
                    prompt_images,
                    &task,
                    &repo,
                    &setup,
                    &runtime,
                );
                let prompt_future = cx
                    .send_request(PromptRequest::new(acp_session_id.clone(), content_blocks))
                    .block_task();
                tokio::pin!(prompt_future);
                let prompt_result = loop {
                    tokio::select! {
                        result = &mut prompt_future => break result,
                        Some(control) = control_rx.recv() => {
                            if let Err(error) = handle_control_message(&cx, &acp_session_id, control).await {
                                emit_error(
                                    &app,
                                    &chat_session_id,
                                    task_id,
                                    agent_profile_id,
                                    &format!("ACP control failed: {error}"),
                                );
                            }
                        }
                    }
                };
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
                    maybe_capture_checkpoint(
                        &db,
                        &cwd_for_checkpoint,
                        &chat_session_id,
                        task_id,
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
                    Some(control) = control_rx.recv() => {
                        if let Err(error) = handle_control_message(&cx, &acp_session_id, control).await {
                            emit_error(
                                &app,
                                &chat_session_id,
                                task_id,
                                agent_profile_id,
                                &format!("ACP control failed: {error}"),
                            );
                        }
                    }
                    else => break,
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
    emit_chat_session_exited(&outer_app, &outer_session, task_id, agent_profile_id);
    // The connection ended (loop drained, or error): drop our own handle so the
    // map doesn't accumulate dead sessions. `chat_session_id` was moved into the
    // connect_with closure, so use the outer clone. (A bare `remove` detaches this
    // task's own JoinHandle; it does not abort the running task.)
    sessions.lock().await.remove(&outer_session);
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AcpSessionSetup {
    cwd: PathBuf,
    additional_directories: Vec<PathBuf>,
    mcp_servers: Vec<McpServer>,
}

impl AcpSessionSetup {
    fn new(cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: cwd.into(),
            additional_directories: Vec::new(),
            mcp_servers: Vec::new(),
        }
    }

    fn additional_directories(mut self, additional_directories: Vec<PathBuf>) -> Self {
        self.additional_directories = additional_directories;
        self
    }

    fn mcp_servers(mut self, mcp_servers: Vec<McpServer>) -> Self {
        self.mcp_servers = mcp_servers;
        self
    }
}

#[derive(Debug, PartialEq, Eq)]
enum AcpSessionStartRequest {
    New {
        setup: AcpSessionSetup,
    },
    Load {
        session_id: SessionId,
        setup: AcpSessionSetup,
    },
}

fn session_start_request(
    setup: AcpSessionSetup,
    resume_acp_session_id: Option<&str>,
    agent_capabilities: &AgentCapabilities,
) -> AcpSessionStartRequest {
    match resume_acp_session_id {
        Some(session_id) if agent_capabilities.load_session => AcpSessionStartRequest::Load {
            session_id: SessionId::new(session_id),
            setup,
        },
        _ => AcpSessionStartRequest::New { setup },
    }
}

fn session_setup_for_task(
    task: &TaskSummary,
    repo: &Repo,
    agent: &AgentProfile,
) -> Result<AcpSessionSetup, String> {
    let cwd = task
        .worktree_path
        .clone()
        .unwrap_or_else(|| repo.path.clone());
    let cwd_path = PathBuf::from(&cwd);
    let mut additional_directories = Vec::new();
    for task_repo in &task.task_repos {
        let Some(path) = &task_repo.worktree_path else {
            continue;
        };
        let path = PathBuf::from(path);
        if path == cwd_path
            || additional_directories
                .iter()
                .any(|existing| existing == &path)
        {
            continue;
        }
        additional_directories.push(path);
    }
    Ok(AcpSessionSetup::new(cwd_path)
        .additional_directories(additional_directories)
        .mcp_servers(profile_mcp_servers(&agent.env)?))
}

fn profile_mcp_servers(env: &BTreeMap<String, String>) -> Result<Vec<McpServer>, String> {
    let Some(raw) = env
        .get("NECTUS_ACP_MCP_SERVERS_JSON")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Ok(Vec::new());
    };
    serde_json::from_str::<Vec<McpServer>>(raw)
        .map_err(|error| format!("Failed to parse NECTUS_ACP_MCP_SERVERS_JSON: {error}"))
}

fn prompt_content_blocks(
    prompt_text: String,
    images: Vec<ChatImageAttachment>,
    task: &TaskSummary,
    repo: &Repo,
    setup: &AcpSessionSetup,
    runtime: &ChatSessionRuntime,
) -> Vec<ContentBlock> {
    let mut blocks = vec![ContentBlock::Text(TextContent::new(prompt_text))];

    if runtime.capabilities.prompt.image {
        blocks.extend(
            images
                .into_iter()
                .map(|image| ContentBlock::Image(ImageContent::new(image.data, image.mime_type))),
        );
    } else if !images.is_empty() {
        tracing::warn!(
            task_id = task.id,
            "dropping image prompt attachments because the ACP agent did not advertise image support"
        );
    }

    if runtime.capabilities.prompt.embedded_context {
        blocks.push(ContentBlock::Resource(EmbeddedResource::new(
            EmbeddedResourceResource::TextResourceContents(
                TextResourceContents::new(
                    task_context_text(task, repo, setup),
                    format!("nectus://task/{}/context", task.id),
                )
                .mime_type("text/markdown".to_string()),
            ),
        )));
    }

    blocks.extend(prompt_resource_links(task, repo, setup));
    blocks
}

fn prompt_resource_links(
    task: &TaskSummary,
    repo: &Repo,
    setup: &AcpSessionSetup,
) -> Vec<ContentBlock> {
    let mut seen = Vec::new();
    let mut blocks = Vec::new();
    push_directory_resource_link(
        &mut blocks,
        &mut seen,
        "primary-worktree",
        "Primary worktree",
        &format!(
            "Primary working directory for task {} in {}.",
            task.id, repo.name
        ),
        &setup.cwd,
    );
    for (index, path) in setup.additional_directories.iter().enumerate() {
        push_directory_resource_link(
            &mut blocks,
            &mut seen,
            &format!("additional-worktree-{}", index + 1),
            "Additional worktree",
            &format!(
                "Additional cross-repo working directory for task {}.",
                task.id
            ),
            path,
        );
    }
    blocks
}

fn push_directory_resource_link(
    blocks: &mut Vec<ContentBlock>,
    seen: &mut Vec<PathBuf>,
    name: &str,
    title: &str,
    description: &str,
    path: &Path,
) {
    let path = path.to_path_buf();
    if seen.iter().any(|existing| existing == &path) {
        return;
    }
    seen.push(path.clone());
    blocks.push(ContentBlock::ResourceLink(
        ResourceLink::new(name, path_file_uri(&path))
            .title(title.to_string())
            .description(description.to_string())
            .mime_type("inode/directory".to_string()),
    ));
}

fn task_context_text(task: &TaskSummary, repo: &Repo, setup: &AcpSessionSetup) -> String {
    let mut lines = vec![
        "# Nectus task context".to_string(),
        format!("- Task ID: {}", task.id),
        format!("- Title: {}", task.title),
        format!("- Status: {}", task.status),
        format!("- Primary project: {} ({})", repo.name, repo.path),
        format!("- Session cwd: {}", setup.cwd.display()),
    ];
    if let Some(branch) = &task.branch_name {
        lines.push(format!("- Branch: {branch}"));
    }
    if let Some(jira_key) = &task.jira_issue_key {
        lines.push(format!("- JIRA issue: {jira_key}"));
    }
    if let Some(summary) = &task.jira_issue_summary {
        lines.push(format!("- JIRA summary: {summary}"));
    }
    if let Some(prompt) = task
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        lines.push(String::new());
        lines.push("## Original task prompt".to_string());
        lines.push(prompt.to_string());
    }
    if !task.task_repos.is_empty() {
        lines.push(String::new());
        lines.push("## Task repositories".to_string());
        for task_repo in &task.task_repos {
            let path = task_repo.worktree_path.as_deref().unwrap_or("no worktree");
            lines.push(format!(
                "- {}: branch {}, path {}",
                task_repo.repo_name,
                task_repo.branch_name.as_deref().unwrap_or("none"),
                path
            ));
        }
    }
    lines.join("\n")
}

fn path_file_uri(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut uri = String::from("file://");
    if !raw.starts_with('/') {
        uri.push('/');
    }
    for byte in raw.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                uri.push(char::from(*byte));
            }
            byte => {
                uri.push('%');
                uri.push_str(&format!("{byte:02X}"));
            }
        }
    }
    uri
}

pub(super) fn build_initialize_request() -> InitializeRequest {
    InitializeRequest::new(ProtocolVersion::V1).client_info(
        Implementation::new("nectus-desktop", env!("CARGO_PKG_VERSION")).title("Nectus Desktop"),
    )
}

fn runtime_capabilities_from_agent(capabilities: &AgentCapabilities) -> ChatRuntimeCapabilities {
    ChatRuntimeCapabilities {
        load_session: capabilities.load_session,
        prompt: ChatPromptCapabilities {
            image: capabilities.prompt_capabilities.image,
            audio: capabilities.prompt_capabilities.audio,
            embedded_context: capabilities.prompt_capabilities.embedded_context,
        },
        mcp: ChatMcpCapabilities {
            http: capabilities.mcp_capabilities.http,
            sse: capabilities.mcp_capabilities.sse,
        },
    }
}

fn runtime_from_initialize_response(response: &InitializeResponse) -> ChatSessionRuntime {
    ChatSessionRuntime {
        capabilities: runtime_capabilities_from_agent(&response.agent_capabilities),
        agent_info: response
            .agent_info
            .as_ref()
            .map(|agent_info| ChatImplementation {
                name: agent_info.name.clone(),
                title: agent_info.title.clone(),
                version: agent_info.version.clone(),
            }),
        auth_methods: response
            .auth_methods
            .iter()
            .map(|method| ChatAuthMethod {
                id: method.id().to_string(),
                name: method.name().to_string(),
                description: method.description().map(ToString::to_string),
            })
            .collect(),
        ..ChatSessionRuntime::default()
    }
}

fn is_runtime_update(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::AvailableCommandsUpdate(_)
            | SessionUpdate::CurrentModeUpdate(_)
            | SessionUpdate::ConfigOptionUpdate(_)
            | SessionUpdate::SessionInfoUpdate(_)
    )
}

fn apply_runtime_update(runtime: &mut ChatSessionRuntime, update: &SessionUpdate) -> bool {
    match update {
        SessionUpdate::AvailableCommandsUpdate(update) => {
            runtime.available_commands = chat_available_commands(update);
            true
        }
        SessionUpdate::CurrentModeUpdate(update) => {
            apply_current_mode_update(runtime, update);
            true
        }
        SessionUpdate::ConfigOptionUpdate(update) => {
            apply_config_option_update(runtime, update);
            true
        }
        SessionUpdate::SessionInfoUpdate(update) => {
            apply_session_info_update(runtime, update);
            true
        }
        _ => false,
    }
}

fn apply_session_mode_state(
    runtime: &mut ChatSessionRuntime,
    modes: Option<&SessionModeState>,
) -> bool {
    let Some(modes) = modes else {
        return false;
    };
    runtime.current_mode_id = Some(modes.current_mode_id.to_string());
    runtime.modes = modes
        .available_modes
        .iter()
        .map(chat_session_mode)
        .collect();
    true
}

fn apply_session_config_options(
    runtime: &mut ChatSessionRuntime,
    config_options: Option<&Vec<SessionConfigOption>>,
) -> bool {
    let Some(config_options) = config_options else {
        return false;
    };
    runtime.config_options = config_options.iter().map(chat_config_option).collect();
    true
}

fn apply_current_mode_update(runtime: &mut ChatSessionRuntime, update: &CurrentModeUpdate) {
    runtime.current_mode_id = Some(update.current_mode_id.to_string());
}

fn apply_config_option_update(runtime: &mut ChatSessionRuntime, update: &ConfigOptionUpdate) {
    runtime.config_options = update
        .config_options
        .iter()
        .map(chat_config_option)
        .collect();
}

fn apply_session_info_update(runtime: &mut ChatSessionRuntime, update: &SessionInfoUpdate) {
    if !update.title.is_undefined() {
        runtime.title = update.title.value().cloned();
    }
    if !update.updated_at.is_undefined() {
        runtime.updated_at = update.updated_at.value().cloned();
    }
}

fn chat_available_commands(update: &AvailableCommandsUpdate) -> Vec<ChatAvailableCommand> {
    update
        .available_commands
        .iter()
        .map(chat_available_command)
        .collect()
}

fn chat_available_command(command: &AvailableCommand) -> ChatAvailableCommand {
    ChatAvailableCommand {
        name: command.name.clone(),
        description: command.description.clone(),
        input_hint: command.input.as_ref().and_then(|input| match input {
            AvailableCommandInput::Unstructured(input) => Some(input.hint.clone()),
            _ => None,
        }),
    }
}

fn chat_session_mode(mode: &SessionMode) -> ChatSessionMode {
    ChatSessionMode {
        id: mode.id.to_string(),
        name: mode.name.clone(),
        description: mode.description.clone(),
    }
}

fn chat_config_option(option: &SessionConfigOption) -> ChatConfigOption {
    let (current_value, options) = match &option.kind {
        SessionConfigKind::Select(select) => (
            Some(select.current_value.to_string()),
            chat_config_select_options(&select.options),
        ),
        _ => (None, Vec::new()),
    };
    ChatConfigOption {
        id: option.id.to_string(),
        name: option.name.clone(),
        description: option.description.clone(),
        current_value,
        options,
    }
}

fn chat_config_select_options(options: &SessionConfigSelectOptions) -> Vec<ChatConfigSelectOption> {
    match options {
        SessionConfigSelectOptions::Ungrouped(options) => options
            .iter()
            .map(|option| ChatConfigSelectOption {
                id: option.value.to_string(),
                name: option.name.clone(),
                description: option.description.clone(),
            })
            .collect(),
        SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| &group.options)
            .map(|option| ChatConfigSelectOption {
                id: option.value.to_string(),
                name: option.name.clone(),
                description: option.description.clone(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn cancel_notification_for_session(session_id: SessionId) -> CancelNotification {
    CancelNotification::new(session_id)
}

async fn handle_control_message(
    cx: &ConnectionTo<Agent>,
    acp_session_id: &SessionId,
    control: AcpControlMessage,
) -> Result<(), agent_client_protocol::Error> {
    match control {
        AcpControlMessage::CancelPrompt => {
            cx.send_notification(cancel_notification_for_session(acp_session_id.clone()))
        }
        AcpControlMessage::SetMode(mode_id) => cx
            .send_request(SetSessionModeRequest::new(acp_session_id.clone(), mode_id))
            .block_task()
            .await
            .map(|_| ()),
        AcpControlMessage::SetConfig {
            config_id,
            value_id,
        } => cx
            .send_request(SetSessionConfigOptionRequest::new(
                acp_session_id.clone(),
                config_id,
                value_id,
            ))
            .block_task()
            .await
            .map(|_| ()),
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
    if message.role == ChatRole::Agent {
        log_turn_part_coverage(message);
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

fn persist_emit_runtime(
    db: &Arc<DbMutex<Database>>,
    app: &AppHandle,
    session_id: &str,
    task_id: i64,
    agent_profile_id: Option<i64>,
    runtime: &ChatSessionRuntime,
) {
    if let Err(error) = db.lock().set_chat_session_runtime(session_id, runtime) {
        tracing::warn!(
            ?error,
            session_id,
            task_id,
            "failed to persist chat runtime"
        );
    }
    let _ = app.emit(
        "session_chat_runtime",
        ChatSessionRuntimeEvent {
            session_id: session_id.to_string(),
            task_id,
            agent_profile_id,
            runtime: runtime.clone(),
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

fn emit_chat_session_exited(
    app: &AppHandle,
    session_id: &str,
    task_id: i64,
    agent_profile_id: Option<i64>,
) {
    let _ = app.emit(
        "chat_session_exited",
        ChatSessionExitedEvent {
            session_id: session_id.to_string(),
            task_id,
            agent_profile_id,
        },
    );
}

fn log_turn_part_coverage(message: &ChatMessage) {
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    for part in &message.parts {
        let key = match part {
            ChatPart::Text { .. } => "text",
            ChatPart::Reasoning { .. } => "reasoning",
            ChatPart::Tool { .. } => "tool",
            ChatPart::FileEdit { .. } => "file_edit",
            ChatPart::Permission { .. } => "permission",
            ChatPart::Plan { .. } => "plan",
            ChatPart::Subagent { .. } => "subagent",
        };
        *counts.entry(key).or_insert(0) += 1;
    }
    tracing::info!(target: "acp.telemetry", part_counts = ?counts, "chat turn settled");
}

fn maybe_capture_checkpoint(
    db: &Arc<DbMutex<Database>>,
    cwd: &str,
    chat_session_id: &str,
    task_id: i64,
    message: &ChatMessage,
) {
    let label = checkpoint_label(message);
    match git_ops::snapshot_chat_checkpoint(std::path::Path::new(cwd)) {
        Ok(commit) => {
            if let Err(error) = db.lock().insert_chat_checkpoint(
                chat_session_id,
                task_id,
                &message.id,
                &commit,
                &label,
            ) {
                tracing::warn!(?error, chat_session_id, "failed to save chat checkpoint");
            }
        }
        Err(error) => tracing::warn!(
            ?error,
            chat_session_id,
            "failed to snapshot chat checkpoint"
        ),
    }
}

fn checkpoint_label(message: &ChatMessage) -> String {
    for part in &message.parts {
        if let ChatPart::Text { text } = part {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                let char_count = trimmed.chars().count();
                let preview: String = trimmed.chars().take(48).collect();
                return if char_count > 48 {
                    format!("{preview}…")
                } else {
                    preview
                };
            }
        }
    }
    let suffix = message.id.chars().take(8).collect::<String>();
    format!("Turn {suffix}")
}

fn resolved_permission_message(
    choice: Option<&str>,
    request: &RequestPermissionRequest,
    message_id: &str,
) -> ChatMessage {
    let resolved_text = match choice {
        Some(option_id) => {
            let label = request
                .options
                .iter()
                .find(|option| option.option_id.0.to_string() == option_id)
                .map(|option| option.name.clone())
                .unwrap_or_else(|| option_id.to_string());
            format!("✓ Permission granted: {label}")
        }
        None => "✗ Permission denied".to_string(),
    };
    ChatMessage {
        id: message_id.to_string(),
        role: ChatRole::Agent,
        parts: vec![ChatPart::Text {
            text: resolved_text,
        }],
        created_at: now(),
        completed_at: Some(now()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{TaskRepo, TaskStatus};
    use agent_client_protocol::schema::{
        AgentCapabilities, AvailableCommand, AvailableCommandsUpdate, ConfigOptionUpdate,
        CurrentModeUpdate, McpCapabilities, McpServer, McpServerStdio, PromptCapabilities,
        SessionConfigOption, SessionInfoUpdate, SessionMode, SessionModeState, SessionUpdate,
    };
    use std::collections::BTreeMap;

    #[test]
    fn initialize_request_identifies_nectus_without_fs_or_terminal_capabilities() {
        let request = build_initialize_request();

        assert_eq!(request.protocol_version, ProtocolVersion::V1);
        assert!(!request.client_capabilities.terminal);
        assert!(!request.client_capabilities.fs.read_text_file);
        assert!(!request.client_capabilities.fs.write_text_file);

        let client_info = request.client_info.expect("client info");
        assert_eq!(client_info.name, "nectus-desktop");
        assert_eq!(client_info.title.as_deref(), Some("Nectus Desktop"));
        assert!(!client_info.version.is_empty());
    }

    #[test]
    fn runtime_capabilities_follow_initialize_response() {
        let capabilities = AgentCapabilities::new()
            .load_session(true)
            .prompt_capabilities(
                PromptCapabilities::new()
                    .image(true)
                    .audio(false)
                    .embedded_context(true),
            )
            .mcp_capabilities(McpCapabilities::new().http(true).sse(false));

        let runtime = runtime_capabilities_from_agent(&capabilities);

        assert!(runtime.load_session);
        assert!(runtime.prompt.image);
        assert!(!runtime.prompt.audio);
        assert!(runtime.prompt.embedded_context);
        assert!(runtime.mcp.http);
        assert!(!runtime.mcp.sse);
    }

    #[test]
    fn start_request_loads_existing_session_only_when_agent_advertises_support() {
        let setup = AcpSessionSetup::new("/tmp/worktree");
        let load_capable = AgentCapabilities::new().load_session(true);
        let not_load_capable = AgentCapabilities::new();

        assert!(matches!(
            session_start_request(setup.clone(), Some("acp-123"), &load_capable),
            AcpSessionStartRequest::Load {
                session_id,
                setup: request_setup
            } if session_id == SessionId::new("acp-123")
                && request_setup.cwd.as_path() == std::path::Path::new("/tmp/worktree")
        ));
        assert!(matches!(
            session_start_request(setup.clone(), Some("acp-123"), &not_load_capable),
            AcpSessionStartRequest::New { setup: request_setup }
                if request_setup.cwd.as_path() == std::path::Path::new("/tmp/worktree")
        ));
        assert!(matches!(
            session_start_request(setup, None, &load_capable),
            AcpSessionStartRequest::New { setup: request_setup }
                if request_setup.cwd.as_path() == std::path::Path::new("/tmp/worktree")
        ));
    }

    #[test]
    fn start_request_preserves_additional_directories_and_mcp_servers() {
        let mcp_servers = vec![McpServer::Stdio(McpServerStdio::new(
            "fixtures",
            "/usr/local/bin/mcp-fixtures",
        ))];
        let setup = AcpSessionSetup::new("/tmp/primary")
            .additional_directories(vec![PathBuf::from("/tmp/secondary")])
            .mcp_servers(mcp_servers.clone());
        let load_capable = AgentCapabilities::new().load_session(true);

        match session_start_request(setup, Some("acp-123"), &load_capable) {
            AcpSessionStartRequest::Load {
                session_id,
                setup: request_setup,
            } => {
                assert_eq!(session_id, SessionId::new("acp-123"));
                assert_eq!(request_setup.cwd, PathBuf::from("/tmp/primary"));
                assert_eq!(
                    request_setup.additional_directories,
                    vec![PathBuf::from("/tmp/secondary")]
                );
                assert_eq!(request_setup.mcp_servers, mcp_servers);
            }
            other => panic!("expected load request, got {other:?}"),
        }
    }

    #[test]
    fn profile_mcp_servers_parse_from_env_json() {
        let env = BTreeMap::from([(
            "NECTUS_ACP_MCP_SERVERS_JSON".to_string(),
            r#"[{"name":"fixtures","command":"/usr/local/bin/mcp-fixtures","args":["--stdio"],"env":[]}]"#.to_string(),
        )]);

        let servers = profile_mcp_servers(&env).unwrap();

        assert_eq!(servers.len(), 1);
        assert!(matches!(&servers[0], McpServer::Stdio(server) if server.name == "fixtures"));
    }

    #[test]
    fn prompt_content_embeds_task_context_when_agent_supports_it() {
        let task = test_task_summary();
        let repo = test_repo();
        let setup = AcpSessionSetup::new("/tmp/Primary Worktree")
            .additional_directories(vec![PathBuf::from("/tmp/Secondary Repo")]);
        let mut runtime = ChatSessionRuntime::default();
        runtime.capabilities.prompt.image = true;
        runtime.capabilities.prompt.embedded_context = true;

        let blocks = prompt_content_blocks(
            "Continue implementation".to_string(),
            vec![ChatImageAttachment {
                data: "base64-image".to_string(),
                mime_type: "image/png".to_string(),
            }],
            &task,
            &repo,
            &setup,
            &runtime,
        );

        assert!(matches!(
            &blocks[0],
            ContentBlock::Text(text) if text.text == "Continue implementation"
        ));
        assert!(blocks
            .iter()
            .any(|block| matches!(block, ContentBlock::Image(_))));
        let context = blocks
            .iter()
            .find_map(|block| match block {
                ContentBlock::Resource(resource) => match &resource.resource {
                    EmbeddedResourceResource::TextResourceContents(text) => Some(text),
                    _ => None,
                },
                _ => None,
            })
            .expect("embedded task context");
        assert_eq!(context.uri, "nectus://task/42/context");
        assert_eq!(context.mime_type.as_deref(), Some("text/markdown"));
        assert!(context.text.contains("Original task prompt"));
        assert!(context.text.contains("Implement ACP resource prompts"));
        assert!(context.text.contains("Secondary Repo"));
        assert!(blocks.iter().any(|block| matches!(
            block,
            ContentBlock::ResourceLink(link)
                if link.uri == "file:///tmp/Primary%20Worktree"
                    && link.mime_type.as_deref() == Some("inode/directory")
        )));
    }

    #[test]
    fn prompt_content_links_workspace_context_without_unsupported_blocks() {
        let task = test_task_summary();
        let repo = test_repo();
        let setup = AcpSessionSetup::new("/tmp/Primary Worktree")
            .additional_directories(vec![PathBuf::from("/tmp/Secondary Repo")]);
        let runtime = ChatSessionRuntime::default();

        let blocks = prompt_content_blocks(
            "Continue implementation".to_string(),
            vec![ChatImageAttachment {
                data: "base64-image".to_string(),
                mime_type: "image/png".to_string(),
            }],
            &task,
            &repo,
            &setup,
            &runtime,
        );

        assert!(blocks
            .iter()
            .all(|block| !matches!(block, ContentBlock::Image(_))));
        assert!(blocks
            .iter()
            .all(|block| !matches!(block, ContentBlock::Resource(_))));
        assert_eq!(
            blocks
                .iter()
                .filter(|block| matches!(block, ContentBlock::ResourceLink(_)))
                .count(),
            2
        );
        assert!(blocks.iter().any(|block| matches!(
            block,
            ContentBlock::ResourceLink(link)
                if link.name == "additional-worktree-1"
                    && link.uri == "file:///tmp/Secondary%20Repo"
        )));
    }

    #[test]
    fn runtime_state_tracks_session_metadata_updates() {
        let mut runtime = ChatSessionRuntime::default();

        apply_runtime_update(
            &mut runtime,
            &SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![
                AvailableCommand::new("test", "Run tests"),
            ])),
        );
        apply_runtime_update(
            &mut runtime,
            &SessionUpdate::CurrentModeUpdate(CurrentModeUpdate::new("code")),
        );
        apply_runtime_update(
            &mut runtime,
            &SessionUpdate::ConfigOptionUpdate(ConfigOptionUpdate::new(vec![
                SessionConfigOption::select(
                    "model",
                    "Model",
                    "fast",
                    vec![
                        agent_client_protocol::schema::SessionConfigSelectOption::new(
                            "fast", "Fast",
                        ),
                    ],
                ),
            ])),
        );
        apply_runtime_update(
            &mut runtime,
            &SessionUpdate::SessionInfoUpdate(
                SessionInfoUpdate::new().title("Implement ACP polish".to_string()),
            ),
        );

        assert_eq!(runtime.available_commands[0].name, "test");
        assert_eq!(runtime.current_mode_id.as_deref(), Some("code"));
        assert_eq!(runtime.config_options[0].id, "model");
        assert_eq!(runtime.title.as_deref(), Some("Implement ACP polish"));
    }

    #[test]
    fn runtime_state_records_session_start_modes_and_config_options() {
        let mut runtime = ChatSessionRuntime::default();
        let modes = SessionModeState::new(
            "plan",
            vec![
                SessionMode::new("plan", "Plan"),
                SessionMode::new("code", "Code"),
            ],
        );
        let config_options = vec![SessionConfigOption::select(
            "model",
            "Model",
            "opus",
            vec![agent_client_protocol::schema::SessionConfigSelectOption::new("opus", "Opus")],
        )];

        apply_session_mode_state(&mut runtime, Some(&modes));
        apply_session_config_options(&mut runtime, Some(&config_options));

        assert_eq!(runtime.current_mode_id.as_deref(), Some("plan"));
        assert_eq!(runtime.modes.len(), 2);
        assert_eq!(
            runtime.config_options[0].current_value.as_deref(),
            Some("opus")
        );
    }

    #[test]
    fn cancel_notification_targets_acp_session_id() {
        let notification = cancel_notification_for_session(SessionId::new("acp-123"));

        assert_eq!(notification.session_id, SessionId::new("acp-123"));
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

    fn test_repo() -> Repo {
        Repo {
            id: 7,
            name: "Nectus".to_string(),
            path: "/repos/nectus".to_string(),
            default_worktree_root: "/worktrees".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            collapsed: false,
        }
    }

    fn test_task_summary() -> TaskSummary {
        TaskSummary {
            id: 42,
            repo_id: 7,
            workspace_id: Some(3),
            title: "ACP resource prompt context".to_string(),
            prompt: Some("Implement ACP resource prompts".to_string()),
            status: TaskStatus::InProgress,
            pr_url: None,
            agent_profile_id: Some(2),
            agent_name: Some("Claude".to_string()),
            agent_kind: None,
            has_worktree: true,
            branch_name: Some("task/acp-resources".to_string()),
            worktree_path: Some("/tmp/Primary Worktree".to_string()),
            is_dirty: false,
            active_session_id: None,
            last_session_id: None,
            last_session_agent: None,
            last_session_cwd: None,
            last_session_label: None,
            review_loop_status: None,
            attention: None,
            archived: false,
            jira_issue_key: Some("NX-42".to_string()),
            jira_issue_summary: Some("Protocol gap closure".to_string()),
            jira_issue_url: None,
            task_repos: vec![
                TaskRepo {
                    repo_id: 7,
                    repo_name: "Nectus".to_string(),
                    branch_name: Some("task/acp-resources".to_string()),
                    worktree_path: Some("/tmp/Primary Worktree".to_string()),
                    pr_url: None,
                    is_dirty: false,
                    position: 0,
                },
                TaskRepo {
                    repo_id: 8,
                    repo_name: "Secondary Repo".to_string(),
                    branch_name: Some("task/acp-resources".to_string()),
                    worktree_path: Some("/tmp/Secondary Repo".to_string()),
                    pr_url: None,
                    is_dirty: false,
                    position: 1,
                },
            ],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }
}
