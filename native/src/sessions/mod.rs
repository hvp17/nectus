use crate::db::Database;
use crate::models::{
    AgentKind, AgentProfile, Repo, Session, SessionActivityEvent, SessionExitedEvent,
    SessionIdleEvent, SessionNeedsInputEvent, SessionOutputEvent, SessionOutputSnapshot,
    SessionState, TaskSummary,
};
use chrono::Utc;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

mod agents;
mod claude;
mod codex;
#[cfg(test)]
mod codex_tests;
mod command;
mod opencode;
mod pr_consensus;
mod pr_review;
mod pr_verdict;
mod pr_worktree;
mod review_loop;
mod reviewer;
mod provider;
mod reviewer_output;
mod terminal_io;
mod verdict;

use agents::configure_agent_command;
use claude::{cleanup_event_sink, spawn_claude_event_watcher};
use codex::{latest_codex_session_metadata, spawn_codex_event_watcher};
use command::resolve_agent_command;
use opencode::{latest_opencode_session_metadata_from_server, spawn_opencode_event_watcher};
use provider::{provider_session, WatcherKind};
use pr_consensus::spawn_consensus_pr_review;
use pr_review::spawn_pr_review;
use review_loop::spawn_review_on_session_idle;
use terminal_io::write_agent_submission;

const OUTPUT_BUFFER_LIMIT: usize = 2 * 1024 * 1024;
// Minimum gap between `session_activity` emissions per session, so spinner
// repaints don't flood the event bus. The UI samples the latest line each tick.
const ACTIVITY_THROTTLE: Duration = Duration::from_millis(300);
// Default PTY size for a freshly spawned agent, before the frontend fits the
// terminal to its pane and resizes. The renderer replays buffered output at the
// session's recorded size, so this is also the width early output is generated at.
const DEFAULT_PTY_ROWS: u16 = 28;
const DEFAULT_PTY_COLS: u16 = 100;

/// A turn-completion or input-request signal parsed from an agent-specific event
/// source. Provider watchers translate their native events into this shape so
/// emission and review kick-off stay in one place.
enum SessionSignal {
    Idle {
        turn_id: Option<String>,
        message: Option<String>,
    },
    NeedsInput {
        turn_id: Option<String>,
        reason: String,
        prompt: Option<String>,
    },
    /// A human-readable "what the agent is doing now" line, parsed from the
    /// provider's structured event stream (Codex reasoning/messages, Claude
    /// tool-use hooks, OpenCode message parts). Replaces the raw-PTY scraper for
    /// those providers, which on a full-screen TUI only surfaced statusline
    /// chrome and echoed keystrokes.
    Activity {
        text: String,
    },
}

/// Emit the frontend event for a session signal and, on idle, spawn any pending
/// review. Shared by provider-specific watchers.
fn emit_session_signal(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    sessions: &Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: &str,
    cwd: &Path,
    signal: SessionSignal,
) {
    match signal {
        SessionSignal::Idle { turn_id, message } => {
            // Idle is the default state, not a persisted attention — clear any prior
            // "needs you" wait so the badge resolves when the agent finishes a turn.
            let _ = db
                .lock()
                .set_task_attention(task_id, None)
                .inspect_err(|error| {
                    tracing::warn!(?error, task_id, "failed to clear task attention")
                });
            let _ = app
                .emit(
                    "session_idle",
                    SessionIdleEvent {
                        session_id: session_id.to_string(),
                        task_id,
                        turn_id,
                        message,
                    },
                )
                .inspect_err(|error| {
                    tracing::warn!(?error, session_id = %session_id, "failed to emit session_idle")
                });
            spawn_review_on_session_idle(
                app.clone(),
                db.clone(),
                sessions.clone(),
                task_id,
                session_id.to_string(),
                cwd.to_path_buf(),
            );
        }
        SessionSignal::NeedsInput {
            turn_id,
            reason,
            prompt,
        } => {
            // Persist the "needs you" signal so it survives an app reload; the
            // frontend reads it back off the task, not an ephemeral store.
            let _ = db
                .lock()
                .set_task_attention(task_id, Some("needs_input"))
                .inspect_err(|error| {
                    tracing::warn!(?error, task_id, "failed to set task attention")
                });
            let _ = app
                .emit(
                    "session_needs_input",
                    SessionNeedsInputEvent {
                        session_id: session_id.to_string(),
                        task_id,
                        turn_id,
                        reason,
                        prompt,
                    },
                )
                .inspect_err(|error| {
                    tracing::warn!(?error, session_id = %session_id, "failed to emit session_needs_input")
                });
        }
        SessionSignal::Activity { text } => {
            emit_activity_line(app, sessions, task_id, session_id, &text);
        }
    }
}

/// Normalize, throttle/de-duplicate, and emit a structured activity line for a
/// session. Shares `last_activity_line`/`last_activity_at` (and the throttle
/// window) with the PTY scraper, which is safe because exactly one of the two
/// paths runs per session — `provider_session(kind).emits_structured_activity`
/// gates the scraper off for the providers that feed this one.
fn emit_activity_line(
    app: &AppHandle,
    sessions: &Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: &str,
    text: &str,
) {
    let candidate = normalize_activity(text);
    let now = Instant::now();
    let line = {
        let mut guard = sessions.lock();
        let Some(running) = guard.get_mut(session_id) else {
            return;
        };
        match activity_to_emit(
            candidate,
            running.last_activity_line.as_deref(),
            running.last_activity_at,
            now,
        ) {
            Some(line) => {
                running.last_activity_line = Some(line.clone());
                running.last_activity_at = Some(now);
                line
            }
            None => return,
        }
    };
    let _ = app
        .emit(
            "session_activity",
            SessionActivityEvent {
                session_id: session_id.to_string(),
                task_id,
                line,
            },
        )
        .inspect_err(|error| {
            tracing::warn!(?error, session_id = %session_id, "failed to emit session activity")
        });
}

/// Walk back from the end of `bytes` to the last valid UTF-8 boundary, returning
/// the valid prefix and the trailing incomplete bytes (at most 3). The event-log
/// tail is read raw because a multi-byte character can be split across a read
/// boundary mid-write; the incomplete tail is left for the next read. The common
/// ASCII-dominant JSONL case returns on the first check.
fn split_at_utf8_boundary(bytes: &[u8]) -> (&[u8], &[u8]) {
    let mut end = bytes.len();
    loop {
        if std::str::from_utf8(&bytes[..end]).is_ok() {
            return (&bytes[..end], &bytes[end..]);
        }
        if end == 0 {
            return (&[], bytes);
        }
        end -= 1;
    }
}

/// Decode `bytes` to text, substituting `�` for genuinely invalid sequences (as
/// [`String::from_utf8_lossy`] does) but *deferring* a final incomplete multi-byte
/// sequence: the returned count is how many trailing bytes form a valid-but-
/// unfinished character that needs more input. Distinguishing the two via
/// [`std::str::Utf8Error::error_len`] (`None` = unexpected end of input vs
/// `Some(n)` = an invalid sequence) is what keeps a glyph split across a read
/// boundary intact (carry it) without letting one stray invalid byte from an
/// arbitrary program stall the stream forever (replace it and keep decoding).
fn decode_utf8_deferring_tail(bytes: &[u8]) -> (String, usize) {
    let mut text = String::new();
    let mut index = 0;
    while index < bytes.len() {
        match std::str::from_utf8(&bytes[index..]) {
            Ok(valid) => {
                text.push_str(valid);
                return (text, 0);
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                // valid_up_to marks a guaranteed-valid prefix, so this never panics.
                if let Ok(valid) = std::str::from_utf8(&bytes[index..index + valid_up_to]) {
                    text.push_str(valid);
                }
                match error.error_len() {
                    // Unexpected end of input: a real char split mid-sequence. Stop
                    // and report the trailing bytes so the next read completes it.
                    None => return (text, bytes.len() - (index + valid_up_to)),
                    // A sequence that can never complete: replace it and keep
                    // decoding past it, so later valid output still flows.
                    Some(invalid_len) => {
                        text.push('\u{fffd}');
                        index += valid_up_to + invalid_len;
                    }
                }
            }
        }
    }
    (text, 0)
}

/// Decode a freshly read PTY chunk to UTF-8 text, stitching it onto any trailing
/// bytes of a multi-byte character that was split across the previous read
/// boundary. `carry` holds those leftover bytes (at most 3) between calls; on
/// return it holds this read's own incomplete tail, if any. PTY output comes from
/// arbitrary programs, so genuinely invalid bytes become `�` and never block the
/// stream (matching the old `from_utf8_lossy`), while a character split by the
/// 8 KiB read boundary stays one intact cell instead of corrupting into `�` —
/// which both mangled box-drawing/CJK glyphs and desynced the agent's
/// cursor-addressed redraws into overlapping frames.
fn decode_pty_chunk(carry: &mut Vec<u8>, read: &[u8]) -> String {
    // Hot path: nothing carried over → decode in place, copying only the rare
    // incomplete tail into `carry`.
    if carry.is_empty() {
        let (text, tail) = decode_utf8_deferring_tail(read);
        if tail > 0 {
            carry.extend_from_slice(&read[read.len() - tail..]);
        }
        return text;
    }
    // A character was split last read: complete it by prepending the carried bytes.
    carry.extend_from_slice(read);
    let (text, tail) = decode_utf8_deferring_tail(carry);
    let consumed = carry.len() - tail;
    carry.drain(..consumed);
    text
}

/// Emit every complete (`\n`-terminated) line in `fragment` via `emit`, trimming a
/// trailing `\r`, and leave `fragment` holding the trailing partial segment (which
/// may be empty). A line caught mid-write — no terminator yet — is never emitted
/// until its `\n` arrives, so each completed line is processed exactly once.
/// (Counting a partial line as complete would skip the finished line and silently
/// drop that turn's idle/needs-input event.)
fn drain_complete_lines(fragment: &mut String, mut emit: impl FnMut(&str)) {
    while let Some(pos) = fragment.find('\n') {
        let line = fragment[..pos].trim_end_matches('\r').to_string();
        emit(&line);
        fragment.drain(..=pos);
    }
}

/// Tail an append-only event log incrementally, translating each newly completed
/// line into a [`SessionSignal`] via `parse_line` and emitting it. Polls every
/// `poll_interval` and exits once the session is no longer running. Tracks a byte
/// offset and reads only the appended tail each tick (not the whole growing file,
/// which a long session makes increasingly expensive), carrying any partial
/// trailing line across ticks via [`drain_complete_lines`]. Shared by the Codex
/// and Claude watchers.
#[allow(clippy::too_many_arguments)]
fn watch_event_log<F>(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    sessions: &Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: &str,
    cwd: &Path,
    log_path: &Path,
    poll_interval: Duration,
    parse_line: F,
) where
    F: Fn(&str) -> Option<SessionSignal>,
{
    let mut read_offset: u64 = 0;
    let mut fragment = String::new();
    loop {
        if !sessions.lock().contains_key(session_id) {
            return;
        }

        // The log may not exist yet (Codex races metadata discovery against the
        // first rollout write); wait and retry, as the old full-read path did.
        let Ok(file) = std::fs::File::open(log_path) else {
            std::thread::sleep(poll_interval);
            continue;
        };

        // The file shrank behind our offset → truncation or rotation (the Claude
        // hook sink is truncated to empty on resume). Reset and re-read from 0.
        let file_len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        if file_len < read_offset {
            read_offset = 0;
            fragment.clear();
        }
        if file_len == read_offset {
            std::thread::sleep(poll_interval);
            continue;
        }

        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(read_offset)).is_err() {
            std::thread::sleep(poll_interval);
            continue;
        }
        let mut raw = Vec::new();
        match reader.read_to_end(&mut raw) {
            Ok(0) => {
                std::thread::sleep(poll_interval);
                continue;
            }
            Ok(_) => {}
            Err(_) => {
                std::thread::sleep(poll_interval);
                continue;
            }
        }

        // A multi-byte char may be split across the read boundary mid-write; keep
        // only the valid UTF-8 prefix and re-read the few trailing bytes next tick.
        let (valid, _) = split_at_utf8_boundary(&raw);
        match std::str::from_utf8(valid) {
            Ok(text) => {
                read_offset += valid.len() as u64;
                fragment.push_str(text);
            }
            // Unreachable: split_at_utf8_boundary returns a valid prefix. Don't
            // advance the offset, so the bytes are re-read next tick.
            Err(_) => {
                std::thread::sleep(poll_interval);
                continue;
            }
        }

        drain_complete_lines(&mut fragment, |line| {
            if let Some(signal) = parse_line(line) {
                emit_session_signal(app, db, sessions, task_id, session_id, cwd, signal);
            }
        });
        std::thread::sleep(poll_interval);
    }
}

/// Cheap to clone: the only field is an `Arc`, so a clone shares the same live
/// session map. Lets command handlers move a handle into `spawn_blocking` and run
/// the blocking session teardown off the main UI thread.
#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
}

struct RunningSession {
    session: Session,
    agent_kind: AgentKind,
    cwd: PathBuf,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output_buffer: String,
    output_truncated: bool,
    output_start_offset: u64,
    output_end_offset: u64,
    rows: u16,
    cols: u16,
    /// Last activity line forwarded to the UI, for de-duplication.
    last_activity_line: Option<String>,
    /// When that line was forwarded, for throttling.
    last_activity_at: Option<Instant>,
    opencode_port: Option<u16>,
}

struct ReviewSessionTarget {
    session_id: String,
    cwd: PathBuf,
}

fn review_session_target<'a>(
    mut sessions: impl Iterator<Item = (&'a Session, &'a PathBuf)>,
    task_id: i64,
) -> Option<ReviewSessionTarget> {
    sessions
        .find(|(session, _)| session.task_id == task_id)
        .map(|(session, cwd)| ReviewSessionTarget {
            session_id: session.id.clone(),
            cwd: cwd.clone(),
        })
}

fn reserve_localhost_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|error| format!("Failed to reserve OpenCode server port: {error}"))
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        task: TaskSummary,
        repo: Repo,
        agent: AgentProfile,
        resume: bool,
    ) -> Result<Session, String> {
        if task.active_session_id.is_some() {
            return Err("Task already has a running session".into());
        }
        let resume_session_id = if resume {
            Some(
                task.last_session_id
                    .as_deref()
                    .ok_or_else(|| "Task does not have a saved session to resume".to_string())?,
            )
        } else {
            None
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: DEFAULT_PTY_ROWS,
                cols: DEFAULT_PTY_COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to open PTY: {error}"))?;

        let session_id = resume_session_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let initial_prompt = task
            .prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let ps = provider_session(agent.agent_kind);
        let opencode_port = if ps.needs_local_server {
            Some(reserve_localhost_port()?)
        } else {
            None
        };
        let executable = resolve_agent_command(&agent.command)?;
        let mut command = CommandBuilder::new(executable);
        configure_agent_command(
            &mut command,
            &agent,
            &session_id,
            resume,
            initial_prompt,
            opencode_port,
        );
        // Bundled apps launched from Finder inherit a minimal environment with no
        // TERM, so agents (Claude Code via Ink/supports-color) render monochrome.
        // Advertise the color-capable terminal xterm.js provides; a profile's own
        // env still wins since it is applied afterwards.
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        // The minimal Finder PATH also lacks Homebrew/user bin dirs, so node-based
        // agent CLIs (e.g. Codex) fail to exec `node`. Hand the session a PATH that
        // includes the common install dirs; a profile's own PATH still wins below.
        command.env("PATH", crate::process_util::augmented_path());
        for (key, value) in &agent.env {
            command.env(key, value);
        }
        let cwd = task.worktree_path.as_deref().unwrap_or(&repo.path);
        let cwd_path = PathBuf::from(cwd);
        command.cwd(cwd);

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Failed to start {}: {error}", agent.name))?;
        let pid = child.process_id();

        // portable-pty's Child is NOT killed on drop, so every fallible step
        // after the spawn must reap the child on failure — otherwise an error
        // here leaks a live, untracked agent process that outlives the app.
        let reap = |child: &mut Box<dyn Child + Send + Sync>| {
            let _ = child.kill();
            let _ = child.wait();
        };
        let mut writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                reap(&mut child);
                return Err(format!("Failed to open PTY writer: {error}"));
            }
        };
        let mut reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                reap(&mut child);
                return Err(format!("Failed to create PTY reader: {error}"));
            }
        };

        if !resume && !ps.sends_prompt_in_args {
            if let Some(prompt) = initial_prompt {
                if let Err(error) = write_agent_submission(writer.as_mut(), prompt) {
                    reap(&mut child);
                    return Err(format!("Failed to send initial prompt: {error}"));
                }
            }
        }

        let session = Session {
            id: session_id.clone(),
            resumable_session_id: Some(session_id.clone()),
            resumable_session_label: task.last_session_label.clone(),
            task_id: task.id,
            agent_profile_id: agent.id,
            state: SessionState::Running,
            pid,
            started_at: Utc::now().to_rfc3339(),
            stopped_at: None,
        };
        let session_id = session.id.clone();
        let started_at = session.started_at.clone();

        if let Err(error) = db.lock().start_session_record(
            task.id,
            &session_id,
            &agent.command,
            cwd,
            task.last_session_label.as_deref(),
        ) {
            reap(&mut child);
            return Err(error);
        }

        tracing::info!(
            session_id = %session_id,
            task_id = task.id,
            agent = %agent.name,
            cwd = %cwd,
            resume,
            "started agent session"
        );

        self.sessions.lock().insert(
            session.id.clone(),
            RunningSession {
                session: session.clone(),
                agent_kind: agent.agent_kind,
                cwd: cwd_path.clone(),
                master: pair.master,
                writer,
                child,
                output_buffer: String::new(),
                output_truncated: false,
                output_start_offset: 0,
                output_end_offset: 0,
                rows: DEFAULT_PTY_ROWS,
                cols: DEFAULT_PTY_COLS,
                last_activity_line: None,
                last_activity_at: None,
                opencode_port,
            },
        );

        match ps.watcher {
            WatcherKind::Codex => spawn_codex_event_watcher(
                app.clone(),
                db.clone(),
                self.sessions.clone(),
                task.id,
                session_id.clone(),
                cwd_path.clone(),
                started_at.clone(),
            ),
            WatcherKind::Claude => spawn_claude_event_watcher(
                app.clone(),
                db.clone(),
                self.sessions.clone(),
                task.id,
                session_id.clone(),
                cwd_path.clone(),
            ),
            WatcherKind::OpenCode => {
                if let Some(port) = opencode_port {
                    spawn_opencode_event_watcher(
                        app.clone(),
                        db.clone(),
                        self.sessions.clone(),
                        task.id,
                        session_id.clone(),
                        cwd_path.clone(),
                        port,
                    );
                }
            }
            WatcherKind::None => {}
        }

        std::thread::spawn({
            let app = app.clone();
            let db = db.clone();
            let sessions = self.sessions.clone();
            let task_id = task.id;
            let session_id = session_id.clone();
            let agent_kind = agent.agent_kind;
            let cwd = cwd_path;
            let started_at = started_at.clone();
            // For providers with a structured event watcher, that watcher owns the
            // activity line; scraping the PTY here would only fight it with TUI
            // chrome and echoed keystrokes (see `provider_session`).
            let scrape_activity = !provider_session(agent_kind).emits_structured_activity;
            move || {
                let mut buffer = [0_u8; 8192];
                // Trailing bytes of a multi-byte character split across a read
                // boundary, carried to the next read so it decodes whole instead of
                // as `�` (see decode_pty_chunk).
                let mut utf8_carry: Vec<u8> = Vec::new();
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => {
                            // EOF with a half-written multi-byte char still buffered:
                            // surface it as a replacement rather than dropping the
                            // bytes (matches from_utf8_lossy on a truncated tail).
                            if !utf8_carry.is_empty() {
                                let data = String::from_utf8_lossy(&utf8_carry).to_string();
                                utf8_carry.clear();
                                let start_offset = sessions
                                    .lock()
                                    .get_mut(&session_id)
                                    .map_or(0, |running| append_output_buffer(running, &data));
                                let _ = app.emit(
                                    "session_output",
                                    SessionOutputEvent {
                                        session_id: session_id.clone(),
                                        data,
                                        start_offset,
                                    },
                                );
                            }
                            break;
                        }
                        Ok(count) => {
                            let data = decode_pty_chunk(&mut utf8_carry, &buffer[..count]);
                            // A read that delivered only the lead bytes of a
                            // character yields no complete text yet; wait for the
                            // rest rather than emit an empty frame.
                            if data.is_empty() {
                                continue;
                            }
                            let mut start_offset = 0;
                            let mut activity_line = None;
                            if let Some(running) = sessions.lock().get_mut(&session_id) {
                                start_offset = append_output_buffer(running, &data);
                                if scrape_activity {
                                    activity_line = next_activity_line(running);
                                }
                            }
                            let _ = app
                                .emit(
                                    "session_output",
                                    SessionOutputEvent {
                                        session_id: session_id.clone(),
                                        data,
                                        start_offset,
                                    },
                                )
                                .inspect_err(|error| {
                                    tracing::warn!(
                                        ?error,
                                        session_id = %session_id,
                                        "failed to emit session output"
                                    )
                                });
                            if let Some(line) = activity_line {
                                let _ = app
                                    .emit(
                                        "session_activity",
                                        SessionActivityEvent {
                                            session_id: session_id.clone(),
                                            task_id,
                                            line,
                                        },
                                    )
                                    .inspect_err(|error| {
                                        tracing::warn!(
                                            ?error,
                                            session_id = %session_id,
                                            "failed to emit session activity"
                                        )
                                    });
                            }
                        }
                        Err(error) => {
                            tracing::debug!(
                                ?error,
                                session_id = %session_id,
                                "session reader stopped"
                            );
                            break;
                        }
                    }
                }
                // Remove from the map first (releasing the lock) so the blocking
                // wait() below never holds the global sessions mutex. Whichever of
                // this thread / stop() wins the remove owns reaping the child, so
                // there is no double wait or double session_exited.
                let removed = sessions.lock().remove(&session_id);
                if let Some(mut running) = removed {
                    // EOF means the child has exited; wait() reaps the zombie and
                    // yields the real status so we can report a true exit code.
                    let exit_code = running.child.wait().ok().map(|status| status.exit_code() as i32);
                    if let Some((id, label)) = resolve_resumable_metadata(
                        agent_kind,
                        &cwd,
                        &started_at,
                        running.opencode_port,
                    ) {
                        let _ = db
                            .lock()
                            .set_last_session(task_id, &id, label.as_deref())
                            .inspect_err(|error| {
                                tracing::warn!(?error, task_id, "failed to save latest session")
                            });
                    }
                    if provider_session(agent_kind).cleanup_event_sink {
                        cleanup_event_sink(&session_id);
                    }
                    let _ = db
                        .lock()
                        .set_active_session(task_id, None)
                        .inspect_err(|error| {
                            tracing::warn!(?error, task_id, "failed to clear active session")
                        });
                    let _ = app
                        .emit(
                            "session_exited",
                            SessionExitedEvent {
                                session_id,
                                exit_code,
                            },
                        )
                        .inspect_err(|error| {
                            tracing::warn!(?error, "failed to emit session_exited")
                        });
                }
            }
        });

        Ok(session)
    }

    pub fn output_snapshot(&self, session_id: &str) -> Result<SessionOutputSnapshot, String> {
        let sessions = self.sessions.lock();
        let running = sessions
            .get(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        Ok(SessionOutputSnapshot {
            session_id: session_id.to_string(),
            data: running.output_buffer.clone(),
            truncated: running.output_truncated,
            start_offset: running.output_start_offset,
            end_offset: running.output_end_offset,
            rows: running.rows,
            cols: running.cols,
        })
    }

    pub fn stop(&self, db: Arc<Mutex<Database>>, session_id: String) -> Result<Session, String> {
        // Remove under the lock, then drop it before the blocking teardown below.
        // Killing/reaping the child (and the Codex/OpenCode metadata probe and DB
        // writes that follow) must NOT hold the global sessions mutex, or every
        // other session command and the live reader threads stall behind it — the
        // same contract the reader thread documents around its own wait().
        let mut running = {
            let mut sessions = self.sessions.lock();
            sessions
                .remove(&session_id)
                .ok_or_else(|| "Session is not running".to_string())?
        };
        let _ = running.child.kill();
        // Reap the just-killed child so it doesn't linger as a zombie until app exit.
        let _ = running.child.wait();
        tracing::info!(
            session_id = %session_id,
            task_id = running.session.task_id,
            "stopped agent session"
        );
        let stopped_at = Utc::now().to_rfc3339();
        running.session.state = SessionState::Stopped;
        running.session.stopped_at = Some(stopped_at);
        if let Some((id, label)) = resolve_resumable_metadata(
            running.agent_kind,
            &running.cwd,
            &running.session.started_at,
            running.opencode_port,
        ) {
            db.lock()
                .set_last_session(running.session.task_id, &id, label.as_deref())?;
            running.session.resumable_session_id = Some(id);
            running.session.resumable_session_label = label;
        }
        if provider_session(running.agent_kind).cleanup_event_sink {
            cleanup_event_sink(&session_id);
        }
        db.lock()
            .set_active_session(running.session.task_id, None)?;
        Ok(running.session)
    }

    pub fn write_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let running = sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        running
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("Failed to write to PTY: {error}"))
    }

    pub fn submit_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let running = sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        write_agent_submission(running.writer.as_mut(), data)
            .map_err(|error| format!("Failed to submit PTY input: {error}"))
    }

    pub fn run_pair_review(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        task_id: i64,
    ) -> Result<(), String> {
        let target = {
            let sessions = self.sessions.lock();
            review_session_target(
                sessions
                    .values()
                    .map(|running| (&running.session, &running.cwd)),
                task_id,
            )
            .ok_or_else(|| {
                "Start review requires a running worker session for this task".to_string()
            })?
        };

        spawn_review_on_session_idle(
            app,
            db,
            self.sessions.clone(),
            task_id,
            target.session_id,
            target.cwd,
        );
        Ok(())
    }

    /// Kick off an external pull-request review on a background thread. Unlike
    /// `run_pair_review`, this owns its own ephemeral worktree and needs no
    /// running worker session.
    pub fn run_pr_review(&self, app: AppHandle, db: Arc<Mutex<Database>>, review_id: i64) {
        spawn_pr_review(app, db, review_id);
    }

    /// Kick off a multi-model consensus PR review on a background thread: several
    /// reviewers review the PR head in parallel in one shared worktree, share
    /// each other's reviews and iterate, and a synthesizer merges the result.
    pub fn run_consensus_pr_review(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        review_id: i64,
    ) {
        spawn_consensus_pr_review(app, db, review_id);
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let running = sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session is not running".to_string())?;
        running
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize PTY: {error}"))?;
        // Record the live size so output_snapshot replays buffered output at the
        // width it was generated at.
        running.rows = rows;
        running.cols = cols;
        Ok(())
    }

    pub fn stop_all(&self, app: &AppHandle, db: Arc<Mutex<Database>>) {
        let ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for session_id in ids {
            if let Ok(session) = self.stop(db.clone(), session_id.clone()) {
                let _ = app
                    .emit(
                        "session_exited",
                        SessionExitedEvent {
                            session_id,
                            exit_code: None,
                        },
                    )
                    .inspect_err(|error| tracing::warn!(?error, "failed to emit session_exited"));
                let _ = db
                    .lock()
                    .set_active_session(session.task_id, None)
                    .inspect_err(|error| {
                        tracing::warn!(
                            ?error,
                            task_id = session.task_id,
                            "failed to clear active session"
                        )
                    });
            }
        }
    }
}

/// Longest activity line we forward to the UI; the card truncates further with
/// an ellipsis, this just bounds the payload.
const ACTIVITY_LINE_MAX: usize = 200;

/// Resolve a finished session's resumable thread id + label, provider-specific:
/// Codex reads its rollout file, OpenCode queries its local server, and providers
/// with no resumable thread (Claude/Gemini/Custom) return `None`. Shared by the
/// reader-thread EOF teardown and `stop()` so the per-provider probe lives once.
fn resolve_resumable_metadata(
    agent_kind: AgentKind,
    cwd: &Path,
    started_at: &str,
    opencode_port: Option<u16>,
) -> Option<(String, Option<String>)> {
    match agent_kind {
        AgentKind::Codex => {
            latest_codex_session_metadata(cwd, started_at).map(|meta| (meta.id, meta.label))
        }
        AgentKind::OpenCode => opencode_port
            .and_then(|port| latest_opencode_session_metadata_from_server(port, cwd))
            .map(|meta| (meta.id, meta.label)),
        AgentKind::Claude | AgentKind::Gemini | AgentKind::Custom => None,
    }
}

/// Reduce a structured progress string to a single short, readable line: take
/// the first line that carries a readable token, strip leading/trailing markdown
/// chrome (bold/heading/backtick markers), and bound it to [`ACTIVITY_LINE_MAX`].
/// Returns `None` when nothing readable remains.
fn normalize_activity(raw: &str) -> Option<String> {
    let line = raw
        .lines()
        .map(str::trim)
        .find(|line| line.chars().any(char::is_alphanumeric))?;
    let line = line.trim_matches(|c: char| matches!(c, '*' | '#' | '`') || c.is_whitespace());
    if line.is_empty() {
        return None;
    }
    Some(line.chars().take(ACTIVITY_LINE_MAX).collect())
}

/// Longest prompt/preview snippet a provider watcher forwards as a needs-input or
/// activity preview (e.g. the question text behind a `session_needs_input`).
const PROMPT_PREVIEW_LIMIT: usize = 500;

/// Trim `value` and bound it to [`PROMPT_PREVIEW_LIMIT`] characters, returning
/// `None` when nothing readable remains. Shared by the Codex and Claude watchers,
/// which both surface short previews of agent prompts/questions.
fn prompt_preview(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.chars().take(PROMPT_PREVIEW_LIMIT).collect())
    }
}

/// Derive the agent's latest human-readable activity line from raw PTY output.
///
/// Agents render full-screen TUIs, so the raw tail is mostly ANSI escapes,
/// carriage-return repaints, spinners, and box-drawing chrome. This strips the
/// escape sequences, treats `\r` and `\n` as line breaks (so an in-place repaint
/// keeps only its final text), and returns the last line that still carries a
/// readable token — skipping spinner/box-only frames. Returns `None` when no
/// meaningful line is present yet.
fn latest_activity_line(buffer: &str) -> Option<String> {
    buffer
        .split(['\n', '\r'])
        .rev()
        .map(|segment| strip_ansi(segment).trim().to_string())
        .find(|line| line.chars().any(char::is_alphanumeric))
        .map(|line| line.chars().take(ACTIVITY_LINE_MAX).collect())
}

/// Remove ANSI escape sequences (CSI and OSC) and stray control bytes from a
/// single line of terminal output. Callers split on `\n`/`\r` first, so neither
/// appears here.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => match chars.peek() {
                // CSI `ESC [ … final`: drop through a final byte in 0x40..=0x7E.
                Some('[') => {
                    chars.next();
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            break;
                        }
                    }
                }
                // OSC `ESC ] … BEL` or `… ESC \`: drop through the terminator.
                Some(']') => {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{07}' {
                            break;
                        }
                        if c == '\u{1b}' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                // Other two-byte escapes: drop ESC and its single intro byte.
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            // Keep tabs (trimmed/collapsed downstream); drop other control bytes.
            c if c.is_control() && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// Compute the activity line to emit for a session after new output, applying
/// de-duplication and throttling, and record what was emitted on the session.
fn next_activity_line(running: &mut RunningSession) -> Option<String> {
    let now = Instant::now();
    let candidate = latest_activity_line(&running.output_buffer);
    let line = activity_to_emit(
        candidate,
        running.last_activity_line.as_deref(),
        running.last_activity_at,
        now,
    )?;
    running.last_activity_line = Some(line.clone());
    running.last_activity_at = Some(now);
    Some(line)
}

/// Pure throttle/de-dup decision: forward `candidate` only when it is present,
/// differs from the last forwarded line, and the throttle window has elapsed.
fn activity_to_emit(
    candidate: Option<String>,
    last_line: Option<&str>,
    last_at: Option<Instant>,
    now: Instant,
) -> Option<String> {
    let line = candidate?;
    if last_line == Some(line.as_str()) {
        return None;
    }
    if let Some(at) = last_at {
        if now.duration_since(at) < ACTIVITY_THROTTLE {
            return None;
        }
    }
    Some(line)
}

fn append_output_buffer(running: &mut RunningSession, data: &str) -> u64 {
    let start_offset = running.output_end_offset;
    running.output_buffer.push_str(data);
    running.output_end_offset += data.len() as u64;

    if running.output_buffer.len() > OUTPUT_BUFFER_LIMIT {
        running.output_truncated = true;
        let excess = running.output_buffer.len() - OUTPUT_BUFFER_LIMIT;
        let drain_to = running
            .output_buffer
            .char_indices()
            .map(|(index, _)| index)
            .find(|index| *index >= excess)
            .unwrap_or(running.output_buffer.len());
        running.output_buffer.drain(..drain_to);
        running.output_start_offset += drain_to as u64;
    }

    start_offset
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, task_id: i64) -> Session {
        Session {
            id: id.to_string(),
            resumable_session_id: Some(id.to_string()),
            resumable_session_label: None,
            task_id,
            agent_profile_id: 2,
            state: SessionState::Running,
            pid: None,
            started_at: "2026-05-17T00:00:00.000Z".to_string(),
            stopped_at: None,
        }
    }

    #[test]
    fn review_session_target_accepts_non_codex_worker_sessions() {
        let codex_cwd = PathBuf::from("/tmp/codex-task");
        let claude_cwd = PathBuf::from("/tmp/claude-task");
        let codex_session = session("codex-session", 7);
        let claude_session = session("claude-session", 42);

        let target = review_session_target(
            [(&codex_session, &codex_cwd), (&claude_session, &claude_cwd)].into_iter(),
            42,
        )
        .expect("review session target should exist");

        assert_eq!(target.session_id, "claude-session");
        assert_eq!(target.cwd, claude_cwd);
    }

    #[test]
    fn activity_line_strips_ansi_and_returns_clean_text() {
        let buffer = "\u{1b}[2m\u{1b}[38;5;244mReading TaskCard.tsx\u{1b}[0m";
        assert_eq!(
            latest_activity_line(buffer),
            Some("Reading TaskCard.tsx".to_string())
        );
    }

    #[test]
    fn normalize_activity_strips_markdown_chrome_and_takes_first_real_line() {
        assert_eq!(
            normalize_activity("**Investigating the failing test**\n\ndetails follow"),
            Some("Investigating the failing test".to_string())
        );
        assert_eq!(
            normalize_activity("## Editing styles.css"),
            Some("Editing styles.css".to_string())
        );
        assert_eq!(
            normalize_activity("`cargo test`"),
            Some("cargo test".to_string())
        );
    }

    #[test]
    fn normalize_activity_skips_blank_and_symbol_only_lines() {
        assert_eq!(normalize_activity("\n\n   \n---\nRunning tests"), Some("Running tests".to_string()));
        assert_eq!(normalize_activity("   \n***\n"), None);
        assert_eq!(normalize_activity(""), None);
    }

    #[test]
    fn normalize_activity_truncates_to_payload_cap() {
        let line = normalize_activity(&"x".repeat(ACTIVITY_LINE_MAX + 50)).expect("a long line survives");
        assert_eq!(line.chars().count(), ACTIVITY_LINE_MAX);
    }

    #[test]
    fn activity_line_picks_last_meaningful_line() {
        let buffer = "Editing styles.css\nRunning tests\n";
        assert_eq!(
            latest_activity_line(buffer),
            Some("Running tests".to_string())
        );
    }

    #[test]
    fn activity_line_uses_final_segment_of_carriage_return_repaint() {
        let buffer = "Thinking...\rApplying patch to mod.rs";
        assert_eq!(
            latest_activity_line(buffer),
            Some("Applying patch to mod.rs".to_string())
        );
    }

    #[test]
    fn activity_line_skips_spinner_and_box_only_frames() {
        let buffer = "Compiling project\n\u{2807} \n\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";
        assert_eq!(
            latest_activity_line(buffer),
            Some("Compiling project".to_string())
        );
    }

    #[test]
    fn activity_line_is_none_when_no_readable_text() {
        assert_eq!(latest_activity_line("   \n\r\n  \u{2500}\u{2500} "), None);
        assert_eq!(latest_activity_line(""), None);
    }

    #[test]
    fn activity_line_truncates_to_payload_cap() {
        let long = "x".repeat(ACTIVITY_LINE_MAX + 50);
        let line = latest_activity_line(&long).expect("a long line survives");
        assert_eq!(line.chars().count(), ACTIVITY_LINE_MAX);
    }

    #[test]
    fn activity_emit_forwards_first_line() {
        let now = Instant::now();
        assert_eq!(
            activity_to_emit(Some("Reading file".to_string()), None, None, now),
            Some("Reading file".to_string())
        );
    }

    #[test]
    fn activity_emit_skips_unchanged_line() {
        let now = Instant::now();
        let earlier = now - ACTIVITY_THROTTLE - Duration::from_millis(10);
        assert_eq!(
            activity_to_emit(Some("Reading file".to_string()), Some("Reading file"), Some(earlier), now),
            None
        );
    }

    #[test]
    fn activity_emit_throttles_rapid_changes() {
        let now = Instant::now();
        let just_now = now - Duration::from_millis(50);
        assert_eq!(
            activity_to_emit(Some("Newer line".to_string()), Some("Older line"), Some(just_now), now),
            None
        );
    }

    #[test]
    fn activity_emit_forwards_changed_line_after_throttle() {
        let now = Instant::now();
        let earlier = now - ACTIVITY_THROTTLE - Duration::from_millis(10);
        assert_eq!(
            activity_to_emit(Some("Newer line".to_string()), Some("Older line"), Some(earlier), now),
            Some("Newer line".to_string())
        );
    }

    #[test]
    fn activity_emit_skips_when_no_candidate() {
        let now = Instant::now();
        assert_eq!(activity_to_emit(None, Some("Older line"), None, now), None);
    }

    fn drain(fragment: &mut String) -> Vec<String> {
        let mut emitted = Vec::new();
        drain_complete_lines(fragment, |line| emitted.push(line.to_string()));
        emitted
    }

    #[test]
    fn drain_complete_lines_defers_partial_trailing_fragment() {
        // First tick: two complete lines plus a fragment caught mid-write.
        let mut fragment = "a\nb\npar".to_string();
        assert_eq!(drain(&mut fragment), vec!["a", "b"]);
        assert_eq!(fragment, "par");

        // Next tick: the rest of the line plus its newline arrives; the line must
        // be emitted exactly once (the partial fragment was never skipped).
        fragment.push_str("tial\n");
        assert_eq!(drain(&mut fragment), vec!["partial"]);
        assert!(fragment.is_empty());
    }

    #[test]
    fn drain_complete_lines_trims_crlf() {
        let mut fragment = "x\r\ny\r\n".to_string();
        assert_eq!(drain(&mut fragment), vec!["x", "y"]);
        assert!(fragment.is_empty());
    }

    #[test]
    fn drain_complete_lines_ignores_a_lone_partial_line() {
        let mut fragment = "still writing".to_string();
        assert!(drain(&mut fragment).is_empty());
        assert_eq!(fragment, "still writing");
    }

    #[test]
    fn split_at_utf8_boundary_passes_through_clean_ascii() {
        let bytes = b"hello\nworld\n";
        let (valid, leftover) = split_at_utf8_boundary(bytes);
        assert_eq!(valid, bytes);
        assert!(leftover.is_empty());
    }

    #[test]
    fn split_at_utf8_boundary_backs_off_incomplete_multibyte() {
        // U+00E9 (é) encodes as [0xC3, 0xA9]; simulate only the first byte arriving.
        let mut bytes = b"abc\n".to_vec();
        bytes.push(0xC3);
        let (valid, leftover) = split_at_utf8_boundary(&bytes);
        assert_eq!(std::str::from_utf8(valid).unwrap(), "abc\n");
        assert_eq!(leftover, &[0xC3u8]);
    }

    #[test]
    fn decode_pty_chunk_passes_clean_ascii_through_without_carry() {
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, b"hello world"), "hello world");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_pty_chunk_stitches_a_box_drawing_char_split_across_two_reads() {
        // Four U+2500 "─" (0xE2 0x94 0x80 each, 12 bytes). A read boundary can fall
        // mid-character; splitting at byte 4 cuts the second "─" after its lead byte
        // — exactly the case the lossy decoder turned into the screenshot's `─��─`.
        let bytes = "────".as_bytes();
        let mut carry = Vec::new();
        let first = decode_pty_chunk(&mut carry, &bytes[..4]);
        let second = decode_pty_chunk(&mut carry, &bytes[4..]);
        let combined = format!("{first}{second}");
        assert_eq!(combined, "────");
        assert!(!combined.contains('\u{fffd}'), "no U+FFFD replacement chars");
        assert!(carry.is_empty(), "carry drains once the sequence completes");
    }

    #[test]
    fn decode_pty_chunk_completes_a_char_delivered_one_byte_per_read() {
        // A single 3-byte "─" trickled in one byte per read: nothing renders until
        // the final byte, then the whole glyph appears exactly once.
        let bytes = "─".as_bytes();
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, &bytes[0..1]), "");
        assert_eq!(decode_pty_chunk(&mut carry, &bytes[1..2]), "");
        assert_eq!(decode_pty_chunk(&mut carry, &bytes[2..3]), "─");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_pty_chunk_replaces_an_invalid_byte_and_keeps_the_stream_moving() {
        // PTY output is arbitrary bytes. A stray 0xFF must not stall later output:
        // it becomes `�` and decoding continues (the lossy path's one redeeming
        // trait, which the carry decoder must preserve).
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, &[0xff]), "\u{fffd}");
        assert!(carry.is_empty(), "an invalid byte is never carried");
        assert_eq!(decode_pty_chunk(&mut carry, b"ok\n"), "ok\n");
    }

    #[test]
    fn decode_pty_chunk_replaces_invalid_bytes_amid_valid_text() {
        // "a" 0xFF "b": the invalid byte is replaced, the surrounding text survives.
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, b"a\xffb"), "a\u{fffd}b");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_pty_chunk_keeps_carry_bounded_for_an_incomplete_4_byte_char() {
        // U+1F600 😀 is 0xF0 0x9F 0x98 0x80 delivered one byte per read: the carry
        // holds the growing prefix (never more than 3 bytes) until the glyph
        // completes — an invalid byte could never inflate it without bound.
        let bytes = "\u{1f600}".as_bytes();
        let mut carry = Vec::new();
        for byte in &bytes[..3] {
            assert_eq!(decode_pty_chunk(&mut carry, &[*byte]), "");
            assert!(carry.len() <= 3, "carry stays bounded at the max UTF-8 tail");
        }
        assert_eq!(decode_pty_chunk(&mut carry, &[bytes[3]]), "\u{1f600}");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_pty_chunk_replaces_an_incomplete_char_killed_by_an_invalid_byte() {
        // 0xE2 (lead byte of "─") then 0xFF (not a continuation): the partial char
        // can never complete, so it's replaced and the stream keeps flowing instead
        // of carrying 0xE2 forever.
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, &[0xe2]), "");
        assert_eq!(carry, vec![0xe2]);
        assert!(decode_pty_chunk(&mut carry, &[0xff]).contains('\u{fffd}'));
        assert!(carry.is_empty());
        assert_eq!(decode_pty_chunk(&mut carry, b"next"), "next");
    }

    #[test]
    fn decode_pty_chunk_preserves_total_byte_length_across_a_split() {
        // The frontend dedupes session_output by byte offset, so emitted bytes must
        // sum to bytes read — the lossy path inflated a 1-byte tail into a 3-byte
        // `�`, corrupting the glyph and skewing the offset math.
        let bytes = "a─b".as_bytes(); // 1 + 3 + 1 = 5 bytes
        let mut carry = Vec::new();
        let first = decode_pty_chunk(&mut carry, &bytes[..2]); // "a" + lead byte of "─"
        let second = decode_pty_chunk(&mut carry, &bytes[2..]);
        assert_eq!(format!("{first}{second}"), "a─b");
        assert_eq!(first.len() + second.len(), bytes.len());
        assert!(carry.is_empty());
    }
}
