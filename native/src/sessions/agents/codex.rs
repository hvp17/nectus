use crate::models::AgentProfile;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

pub(super) fn configure(
    command: &mut CommandBuilder,
    agent: &AgentProfile,
    session_id: &str,
    resume: bool,
) {
    if !resume {
        super::add_model_arg(command, agent);
    }
    if resume {
        command.arg("resume");
    }
    super::add_agent_args(command, agent);
    if resume {
        command.arg(session_id);
    }
}

pub(super) fn fallback_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/Applications/Codex.app/Contents/Resources/codex",
    )];
    if let Some(home) = home {
        candidates.push(
            home.join("Applications")
                .join("Codex.app")
                .join("Contents")
                .join("Resources")
                .join("codex"),
        );
    }
    candidates
}
