use super::{watch_event_log, RunningSession, SessionSignal};
use crate::db::Database;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

const CLAUDE_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CLAUDE_PROMPT_PREVIEW_LIMIT: usize = 500;

// ---------------------------------------------------------------------------
// Claude Code hook event bridge
//
// Unlike Codex, Claude Code has no protocol JSONL we can tail for turn-completion
// or input-request signals (its transcript only records `stop_reason`, with no
// clean "needs permission/input" marker, behind an undocumented cwd→dirname
// encoding). Instead we use Claude Code hooks, injected at launch via
// `claude --settings '<inline JSON>'` (which the CLI merges with the user's own
// settings, so their hooks are preserved):
//
//   * the `Stop` hook fires when a turn finishes        -> `session_idle`
//   * the `Notification` hook (matcher `permission_prompt|elicitation_dialog`)
//     fires when Claude needs the user                  -> `session_needs_input`
//   * the `PreToolUse` hook (matcher `*`) fires before each
//     tool runs                                         -> `session_activity`
//
// Each hook is a tiny POSIX command that appends its stdin payload as one JSON
// line to a nectus-owned sink keyed by the session UUID we already pass via
// `--session-id`. `spawn_claude_event_watcher` tails that sink and emits the same
// events the Codex watcher does, reusing the whole frontend/DB/notification path.
// The `PreToolUse` hook is purely observational: it appends and exits 0 without
// printing, so the tool always proceeds (exit 2 would be the only blocking code).
// ---------------------------------------------------------------------------

/// One line written to the sink by a hook command:
/// `{"kind":"idle"|"needs_input","payload":<verbatim hook stdin JSON>}`.
#[derive(Debug, Deserialize)]
struct ClaudeHookLine {
    kind: String,
    #[serde(default)]
    payload: ClaudeHookPayload,
}

/// Tolerant view of the JSON Claude Code passes a hook on stdin. Only the fields
/// that carry a human-readable signal are modelled; everything else is ignored.
#[derive(Debug, Default, Deserialize)]
struct ClaudeHookPayload {
    /// Notification text (e.g. the permission prompt). Present on `Notification`.
    #[serde(default)]
    message: Option<String>,
    /// Notification type the matcher fired on (`permission_prompt`, …).
    #[serde(default)]
    notification_type: Option<String>,
    /// Claude's final turn message, when the `Stop` payload carries it.
    #[serde(default)]
    last_assistant_message: Option<String>,
    /// The tool about to run. Present on `PreToolUse`.
    #[serde(default)]
    tool_name: Option<String>,
    /// The tool's input arguments (`command`, `file_path`, …). Present on
    /// `PreToolUse`; shape varies by tool.
    #[serde(default)]
    tool_input: Option<Value>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ClaudeSessionEvent {
    Idle {
        message: Option<String>,
    },
    NeedsInput {
        reason: String,
        prompt: Option<String>,
    },
    Activity {
        text: String,
    },
}

/// Path of the per-session hook sink. Keyed by the session UUID so it is
/// deterministic for both the launcher (which embeds it in the hook command) and
/// the watcher (which tails it), with no dependency on Claude's transcript layout.
pub(super) fn event_sink_path(session_id: &str) -> PathBuf {
    env::temp_dir()
        .join("nectus")
        .join("claude-hooks")
        .join(format!("{session_id}.jsonl"))
}

/// Create the sink's parent directory and truncate any existing file, so a
/// resumed session (same UUID, same path) never replays a previous run's events.
fn prepare_event_sink(session_id: &str) -> std::io::Result<PathBuf> {
    let path = event_sink_path(session_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, "")?;
    Ok(path)
}

/// Best-effort removal of the sink once the session ends.
pub(super) fn cleanup_event_sink(session_id: &str) {
    let _ = fs::remove_file(event_sink_path(session_id));
}

/// Build the inline `--settings` JSON that wires Claude Code's `Stop`,
/// `Notification`, and `PreToolUse` hooks to append their payload to `sink`.
pub(super) fn hook_settings_json(sink: &Path) -> String {
    let idle = append_command(sink, "idle");
    let needs_input = append_command(sink, "needs_input");
    let activity = append_command(sink, "activity");
    let settings = serde_json::json!({
        "hooks": {
            "Stop": [{
                "hooks": [{ "type": "command", "command": idle, "timeout": 10 }]
            }],
            "Notification": [{
                "matcher": "permission_prompt|elicitation_dialog",
                "hooks": [{ "type": "command", "command": needs_input, "timeout": 10 }]
            }],
            "PreToolUse": [{
                "matcher": "*",
                "hooks": [{ "type": "command", "command": activity, "timeout": 10 }]
            }]
        }
    });
    // `serde_json::json!` cannot fail to serialize; the unwrap is infallible.
    serde_json::to_string(&settings).expect("hook settings serialize")
}

/// A POSIX shell command that wraps the hook's stdin JSON as one line
/// `{"kind":"<kind>","payload":<stdin>}` and appends it to `sink`. `tr -d '\n'`
/// only removes structural newlines (JSON escapes newlines inside strings), so
/// the appended line stays valid single-line JSON.
fn append_command(sink: &Path, kind: &str) -> String {
    let sink = shell_single_quote(&sink.to_string_lossy());
    format!(
        "{{ printf '{{\"kind\":\"{kind}\",\"payload\":'; tr -d '\\n'; printf '}}\\n'; }} >> {sink}"
    )
}

/// Wrap `value` in single quotes for POSIX `sh`, escaping any embedded quote.
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) fn spawn_claude_event_watcher(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    sessions: Arc<Mutex<HashMap<String, RunningSession>>>,
    task_id: i64,
    session_id: String,
    cwd: PathBuf,
) {
    std::thread::spawn(move || {
        let sink = match prepare_event_sink(&session_id) {
            Ok(path) => path,
            Err(error) => {
                tracing::warn!(
                    ?error,
                    session_id = %session_id,
                    "failed to prepare Claude hook sink; idle/needs-input events disabled"
                );
                return;
            }
        };
        tracing::info!(
            session_id = %session_id,
            task_id,
            path = %sink.display(),
            "watching Claude hook sink"
        );

        watch_event_log(
            &app,
            &db,
            &sessions,
            task_id,
            &session_id,
            &cwd,
            &sink,
            CLAUDE_POLL_INTERVAL,
            claude_signal_from_line,
        );
    });
}

/// Translate a Claude hook-sink line into a [`SessionSignal`]. Claude carries no
/// turn id, so both arms use `turn_id: None`.
fn claude_signal_from_line(line: &str) -> Option<SessionSignal> {
    match claude_session_event_from_line(line)? {
        ClaudeSessionEvent::Idle { message } => Some(SessionSignal::Idle {
            turn_id: None,
            message,
        }),
        ClaudeSessionEvent::NeedsInput { reason, prompt } => Some(SessionSignal::NeedsInput {
            turn_id: None,
            reason,
            prompt,
        }),
        ClaudeSessionEvent::Activity { text } => Some(SessionSignal::Activity { text }),
    }
}

pub(super) fn claude_session_event_from_line(line: &str) -> Option<ClaudeSessionEvent> {
    let line = serde_json::from_str::<ClaudeHookLine>(line).ok()?;
    match line.kind.as_str() {
        "idle" => Some(ClaudeSessionEvent::Idle {
            message: line
                .payload
                .last_assistant_message
                .as_deref()
                .and_then(prompt_preview),
        }),
        "needs_input" => Some(ClaudeSessionEvent::NeedsInput {
            reason: line
                .payload
                .notification_type
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "needs_input".to_string()),
            prompt: line.payload.message.as_deref().and_then(prompt_preview),
        }),
        "activity" => claude_activity_text(
            line.payload.tool_name.as_deref().unwrap_or_default(),
            line.payload.tool_input.as_ref(),
        )
        .map(|text| ClaudeSessionEvent::Activity { text }),
        _ => None,
    }
}

/// Turn a `PreToolUse` `tool_name` + `tool_input` into a short "doing now" line,
/// e.g. `Editing App.tsx`, `Running npm test`, `Reading types.ts`. Falls back to
/// `<Tool>: <detail>` for tools without a known verb, then to the bare tool name.
/// `None` only when there is no tool name at all.
fn claude_activity_text(tool_name: &str, tool_input: Option<&Value>) -> Option<String> {
    let tool_name = tool_name.trim();
    if tool_name.is_empty() {
        return None;
    }
    let verb = match tool_name {
        "Edit" | "MultiEdit" | "NotebookEdit" => Some("Editing"),
        "Write" => Some("Writing"),
        "Read" | "NotebookRead" => Some("Reading"),
        "Bash" | "BashOutput" => Some("Running"),
        "Grep" => Some("Searching"),
        "Glob" => Some("Finding"),
        "WebFetch" => Some("Fetching"),
        "WebSearch" => Some("Searching"),
        _ => None,
    };
    let detail = tool_input.and_then(claude_tool_detail);
    Some(match (verb, detail) {
        (Some(verb), Some(detail)) => format!("{verb} {detail}"),
        (None, Some(detail)) => format!("{tool_name}: {detail}"),
        (_, None) => tool_name.to_string(),
    })
}

/// Pull a human-readable detail out of a tool's input: a file's basename for
/// path-shaped tools, otherwise the first line of the most relevant string field.
fn claude_tool_detail(input: &Value) -> Option<String> {
    const PATH_KEYS: [&str; 3] = ["file_path", "notebook_path", "path"];
    const TEXT_KEYS: [&str; 5] = ["command", "pattern", "url", "query", "description"];
    for key in PATH_KEYS {
        if let Some(value) = string_field(input, key) {
            let base = value.rsplit('/').next().unwrap_or(value);
            return prompt_preview(base);
        }
    }
    for key in TEXT_KEYS {
        if let Some(value) = string_field(input, key) {
            return value.lines().next().and_then(prompt_preview);
        }
    }
    None
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn prompt_preview(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.chars().take(CLAUDE_PROMPT_PREVIEW_LIMIT).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_line_carries_last_assistant_message() {
        let event = claude_session_event_from_line(
            r#"{"kind":"idle","payload":{"last_assistant_message":"  Done.  "}}"#,
        );
        assert_eq!(
            event,
            Some(ClaudeSessionEvent::Idle {
                message: Some("Done.".to_string()),
            })
        );
    }

    #[test]
    fn idle_line_without_message_is_still_idle() {
        let event = claude_session_event_from_line(r#"{"kind":"idle","payload":{}}"#);
        assert_eq!(event, Some(ClaudeSessionEvent::Idle { message: None }));
    }

    #[test]
    fn needs_input_line_uses_notification_type_and_message() {
        let event = claude_session_event_from_line(
            r#"{"kind":"needs_input","payload":{"notification_type":"permission_prompt","message":"Allow git push?"}}"#,
        );
        assert_eq!(
            event,
            Some(ClaudeSessionEvent::NeedsInput {
                reason: "permission_prompt".to_string(),
                prompt: Some("Allow git push?".to_string()),
            })
        );
    }

    #[test]
    fn needs_input_line_falls_back_to_generic_reason() {
        let event = claude_session_event_from_line(r#"{"kind":"needs_input","payload":{}}"#);
        assert_eq!(
            event,
            Some(ClaudeSessionEvent::NeedsInput {
                reason: "needs_input".to_string(),
                prompt: None,
            })
        );
    }

    #[test]
    fn activity_line_for_bash_is_running_command_first_line() {
        // The command's first line only; trailing newline / extra lines dropped.
        let event = claude_session_event_from_line(
            r#"{"kind":"activity","payload":{"tool_name":"Bash","tool_input":{"command":"npm test\nshould-not-appear"}}}"#,
        );
        assert_eq!(
            event,
            Some(ClaudeSessionEvent::Activity {
                text: "Running npm test".to_string(),
            })
        );
    }

    #[test]
    fn activity_line_for_edit_uses_verb_and_basename() {
        let event = claude_session_event_from_line(
            r#"{"kind":"activity","payload":{"tool_name":"Edit","tool_input":{"file_path":"/Users/x/proj/src/App.tsx"}}}"#,
        );
        assert_eq!(
            event,
            Some(ClaudeSessionEvent::Activity {
                text: "Editing App.tsx".to_string(),
            })
        );
    }

    #[test]
    fn activity_line_for_bash_uses_running_verb() {
        assert_eq!(
            claude_activity_text("Bash", Some(&serde_json::json!({"command":"cargo build"}))),
            Some("Running cargo build".to_string())
        );
    }

    #[test]
    fn activity_line_falls_back_to_tool_name_without_detail() {
        assert_eq!(
            claude_activity_text("TodoWrite", Some(&serde_json::json!({"todos":[]}))),
            Some("TodoWrite".to_string())
        );
        assert_eq!(
            claude_activity_text("Task", Some(&serde_json::json!({"description":"Audit auth"}))),
            Some("Task: Audit auth".to_string())
        );
    }

    #[test]
    fn activity_line_without_tool_name_is_ignored() {
        assert_eq!(
            claude_session_event_from_line(r#"{"kind":"activity","payload":{}}"#),
            None
        );
        assert_eq!(claude_activity_text("  ", None), None);
    }

    #[test]
    fn unknown_kind_and_malformed_lines_are_ignored() {
        assert_eq!(
            claude_session_event_from_line(r#"{"kind":"banana","payload":{}}"#),
            None
        );
        assert_eq!(claude_session_event_from_line("not json at all"), None);
        assert_eq!(claude_session_event_from_line(""), None);
    }

    #[test]
    fn hook_settings_json_wires_both_hooks_to_the_sink() {
        let sink = Path::new("/tmp/nectus/claude-hooks/abc.jsonl");
        let settings: serde_json::Value =
            serde_json::from_str(&hook_settings_json(sink)).expect("valid JSON");

        let stop_cmd = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(stop_cmd.contains(r#""kind":"idle""#));
        assert!(stop_cmd.contains("'/tmp/nectus/claude-hooks/abc.jsonl'"));

        assert_eq!(
            settings["hooks"]["Notification"][0]["matcher"],
            "permission_prompt|elicitation_dialog"
        );
        let notif_cmd = settings["hooks"]["Notification"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(notif_cmd.contains(r#""kind":"needs_input""#));

        assert_eq!(settings["hooks"]["PreToolUse"][0]["matcher"], "*");
        let activity_cmd = settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(activity_cmd.contains(r#""kind":"activity""#));
        assert!(activity_cmd.contains("'/tmp/nectus/claude-hooks/abc.jsonl'"));
    }

    #[test]
    fn shell_single_quote_escapes_embedded_quote() {
        assert_eq!(shell_single_quote("/tmp/plain"), "'/tmp/plain'");
        assert_eq!(shell_single_quote("a'b"), r"'a'\''b'");
    }

    #[test]
    fn event_sink_path_is_keyed_by_session_id() {
        let path = event_sink_path("sess-123");
        assert!(path.ends_with("nectus/claude-hooks/sess-123.jsonl"));
    }
}
