use crate::models::AgentProfile;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

pub(super) fn configure(
    command: &mut CommandBuilder,
    agent: &AgentProfile,
    session_id: &str,
    resume: bool,
) {
    super::add_model_arg(command, agent);
    super::add_agent_args(command, agent);
    if resume {
        command.arg("--resume");
    } else {
        command.arg("--session-id");
    }
    command.arg(session_id);
}

pub(super) fn fallback_candidates(_home: Option<&Path>) -> Vec<PathBuf> {
    Vec::new()
}
