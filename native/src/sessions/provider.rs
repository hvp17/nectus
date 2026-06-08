//! The single source of truth for per-provider session-lifecycle facts. Adding a
//! provider, or changing one provider's lifecycle behavior, is one edit here; the
//! lifecycle sites in `mod.rs` (port reservation, watcher spawn, PTY-scrape gate,
//! initial-prompt delivery, post-exit teardown) consume this descriptor instead of
//! re-deriving the same `if Codex … else if Claude …` ladder in each place.

use crate::models::AgentKind;

/// Per-provider session-lifecycle capabilities. `Copy` and stack-allocated — a
/// config record, not a behavior object: the provider modules still own their
/// watcher/probe functions, this just states which apply to a given provider.
#[derive(Debug, Clone, Copy)]
pub(super) struct ProviderSession {
    /// A local-server port must be reserved before the PTY launches (OpenCode).
    pub needs_local_server: bool,
    /// The provider emits structured activity from its watcher, so the raw-PTY
    /// activity scraper is suppressed (on a full-screen TUI it would only surface
    /// statusline chrome and the user's echoed keystrokes).
    pub emits_structured_activity: bool,
    /// The initial prompt is passed as a CLI argument (OpenCode) rather than
    /// written to the PTY after spawn.
    pub sends_prompt_in_args: bool,
    /// The provider writes a hook-sink file that must be removed on teardown (Claude).
    pub cleanup_event_sink: bool,
    /// Which structured event watcher to spawn alongside the PTY (or none).
    pub watcher: WatcherKind,
}

/// The structured event watcher a provider spawns. `None` for Gemini/Custom, which
/// have no structured stream and rely on the raw-PTY activity scraper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WatcherKind {
    Codex,
    Claude,
    OpenCode,
    None,
}

/// The lifecycle descriptor for a provider — the one place these facts live.
pub(super) fn provider_session(kind: AgentKind) -> ProviderSession {
    match kind {
        AgentKind::Codex => ProviderSession {
            needs_local_server: false,
            emits_structured_activity: true,
            sends_prompt_in_args: false,
            cleanup_event_sink: false,
            watcher: WatcherKind::Codex,
        },
        AgentKind::Claude => ProviderSession {
            needs_local_server: false,
            emits_structured_activity: true,
            sends_prompt_in_args: false,
            cleanup_event_sink: true,
            watcher: WatcherKind::Claude,
        },
        AgentKind::OpenCode => ProviderSession {
            needs_local_server: true,
            emits_structured_activity: true,
            sends_prompt_in_args: true,
            cleanup_event_sink: false,
            watcher: WatcherKind::OpenCode,
        },
        AgentKind::Gemini | AgentKind::Custom => ProviderSession {
            needs_local_server: false,
            emits_structured_activity: false,
            sends_prompt_in_args: false,
            cleanup_event_sink: false,
            watcher: WatcherKind::None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_activity_providers_have_a_watcher() {
        for kind in [AgentKind::Codex, AgentKind::Claude, AgentKind::OpenCode] {
            let ps = provider_session(kind);
            assert!(ps.emits_structured_activity);
            assert_ne!(ps.watcher, WatcherKind::None);
        }
        for kind in [AgentKind::Gemini, AgentKind::Custom] {
            let ps = provider_session(kind);
            assert!(!ps.emits_structured_activity);
            assert_eq!(ps.watcher, WatcherKind::None);
        }
    }

    #[test]
    fn only_opencode_needs_a_local_server_and_arg_prompt() {
        let oc = provider_session(AgentKind::OpenCode);
        assert!(oc.needs_local_server && oc.sends_prompt_in_args);
        for kind in [AgentKind::Codex, AgentKind::Claude, AgentKind::Gemini, AgentKind::Custom] {
            let ps = provider_session(kind);
            assert!(!ps.needs_local_server && !ps.sends_prompt_in_args);
        }
    }

    #[test]
    fn only_claude_cleans_up_an_event_sink() {
        assert!(provider_session(AgentKind::Claude).cleanup_event_sink);
        for kind in [AgentKind::Codex, AgentKind::OpenCode, AgentKind::Gemini, AgentKind::Custom] {
            assert!(!provider_session(kind).cleanup_event_sink);
        }
    }
}
