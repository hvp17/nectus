use crate::models::AgentProfile;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

/// Google Antigravity CLI (`agy`) — the successor to the retired Gemini CLI.
/// Interactive TUI by default; the model is selected with `-m` (not `--model`),
/// and the profile's own args follow.
pub(super) fn configure(command: &mut CommandBuilder, agent: &AgentProfile) {
    if let Some(model) = agent
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("-m");
        command.arg(model);
    }
    super::add_agent_args(command, agent);
}

/// The install script (`antigravity.google/cli/install.sh`) places `agy` under
/// the user's home; cover its dir plus the generic user-bin fallbacks handled
/// by the shared candidates.
pub(super) fn fallback_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let Some(home) = home else {
        return Vec::new();
    };
    vec![home.join(".antigravity").join("bin").join("agy")]
}
