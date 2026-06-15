//! The single source of truth for per-provider session-lifecycle facts. Adding a
//! provider, or changing one provider's lifecycle behavior, is one edit here; the
//! lifecycle sites in `mod.rs` (port reservation, PTY-scrape gate, initial-prompt
//! delivery, post-exit teardown) consume this descriptor instead of re-deriving
//! the same `if Codex … else if Claude …` ladder in each place.
//!
//! Legacy JSONL / hook / SSE watchers (`codex.rs`, `claude.rs`, `opencode.rs`) are
//! retired — ACP chat owns structured activity for Claude/Codex/OpenCode.

use crate::models::AgentKind;

/// Per-provider session-lifecycle capabilities. `Copy` and stack-allocated — a
/// config record, not a behavior object.
#[derive(Debug, Clone, Copy)]
pub(super) struct ProviderSession {
    /// A local-server port must be reserved before the PTY launches (OpenCode).
    pub needs_local_server: bool,
    /// The provider emits structured activity from a legacy watcher (none do today).
    pub emits_structured_activity: bool,
    /// The initial prompt is passed as a CLI argument (OpenCode) rather than
    /// written to the PTY after spawn.
    pub sends_prompt_in_args: bool,
}

/// The lifecycle descriptor for a provider — the one place these facts live.
pub(super) fn provider_session(kind: AgentKind) -> ProviderSession {
    match kind {
        AgentKind::OpenCode => ProviderSession {
            needs_local_server: true,
            emits_structured_activity: false,
            sends_prompt_in_args: true,
        },
        AgentKind::Codex | AgentKind::Claude | AgentKind::Antigravity | AgentKind::Custom => {
            ProviderSession {
                needs_local_server: false,
                emits_structured_activity: false,
                sends_prompt_in_args: false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_capable_agents_no_longer_spawn_legacy_watchers() {
        for kind in [AgentKind::Codex, AgentKind::Claude, AgentKind::OpenCode] {
            let ps = provider_session(kind);
            assert!(!ps.emits_structured_activity);
        }
    }

    #[test]
    fn only_opencode_needs_a_local_server_and_arg_prompt() {
        let oc = provider_session(AgentKind::OpenCode);
        assert!(oc.needs_local_server && oc.sends_prompt_in_args);
        for kind in [
            AgentKind::Codex,
            AgentKind::Claude,
            AgentKind::Antigravity,
            AgentKind::Custom,
        ] {
            let ps = provider_session(kind);
            assert!(!ps.needs_local_server);
            assert!(!ps.sends_prompt_in_args);
        }
    }
}
