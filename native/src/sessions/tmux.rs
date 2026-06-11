//! tmux backing for opt-in persistent sessions.
//!
//! When the `persistent_sessions` setting is on (and `tmux` is installed), agent
//! sessions are launched inside a **dedicated tmux server** (`-L nectus`, so the
//! user's own tmux is never touched). The PTY child the app owns is then just a
//! tmux *client*: closing the app kills the client but the agent keeps running
//! in the tmux session, and the next launch reattaches a new client to it.

use crate::process_util;
use std::ffi::OsString;
use std::process::Command;
use std::sync::OnceLock;

/// Dedicated tmux server socket name — isolates Nectus sessions from any tmux
/// the user runs themselves.
pub const TMUX_SOCKET: &str = "nectus";

const SESSION_PREFIX: &str = "nectus-";

/// The tmux session name carrying a Nectus session id.
pub fn tmux_session_name(session_id: &str) -> String {
    format!("{SESSION_PREFIX}{session_id}")
}

/// The Nectus session id inside a tmux session name, if it is one of ours.
pub fn session_id_from_tmux_name(name: &str) -> Option<&str> {
    name.strip_prefix(SESSION_PREFIX)
        .filter(|id| !id.is_empty())
}

/// Resolved tmux binary, or `None` when tmux is not installed. Probed once per
/// app run (`tmux -V`), so callers can branch cheaply.
pub fn tmux_binary() -> Option<&'static OsString> {
    static TMUX: OnceLock<Option<OsString>> = OnceLock::new();
    TMUX.get_or_init(|| {
        let candidate = process_util::resolve_executable("tmux");
        let probe = Command::new(&candidate)
            .arg("-V")
            .env("PATH", process_util::augmented_path())
            .output();
        match probe {
            Ok(output) if output.status.success() => Some(candidate),
            _ => None,
        }
    })
    .as_ref()
}

fn tmux_command(tmux: &OsString) -> Command {
    let mut command = Command::new(tmux);
    command.arg("-L").arg(TMUX_SOCKET);
    command.env("PATH", process_util::augmented_path());
    command
}

/// Nectus session ids still alive on the dedicated tmux server. An unreachable
/// server (not running) is simply "no sessions".
pub fn list_live_session_ids() -> Vec<String> {
    let Some(tmux) = tmux_binary() else {
        return Vec::new();
    };
    let Ok(output) = tmux_command(tmux)
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| session_id_from_tmux_name(line.trim()).map(ToOwned::to_owned))
        .collect()
}

/// Kill one Nectus tmux session (used by Stop and by boot cleanup of sessions
/// whose task no longer exists). Best-effort.
pub fn kill_session(session_id: &str) {
    let Some(tmux) = tmux_binary() else { return };
    let _ = tmux_command(tmux)
        .args(["kill-session", "-t", &tmux_session_name(session_id)])
        .output();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmux_session_names_round_trip_the_session_id() {
        let name = tmux_session_name("abc-123");
        assert_eq!(name, "nectus-abc-123");
        assert_eq!(session_id_from_tmux_name(&name), Some("abc-123"));
        assert_eq!(session_id_from_tmux_name("nectus-"), None);
        assert_eq!(session_id_from_tmux_name("other-abc"), None);
    }
}
