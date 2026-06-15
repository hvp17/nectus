//! Claude Code hook settings for PTY-launched sessions (`--settings` inline JSON).
//! Hook sinks are keyed by the Nectus session UUID; ACP chat does not use them.

use std::env;
use std::path::{Path, PathBuf};

/// Path of the per-session hook sink. Keyed by the session UUID so it is
/// deterministic for the launcher (which embeds it in the hook command).
pub(super) fn event_sink_path(session_id: &str) -> PathBuf {
    env::temp_dir()
        .join("nectus")
        .join("claude-hooks")
        .join(format!("{session_id}.jsonl"))
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
    serde_json::to_string(&settings).expect("hook settings serialize")
}

/// A POSIX shell command that wraps the hook's stdin JSON as one line
/// `{"kind":"<kind>","payload":<stdin>}` and appends it to `sink`.
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

#[cfg(test)]
mod tests {
    use super::*;

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
