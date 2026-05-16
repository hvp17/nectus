use crate::models::AgentProfile;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

pub(super) fn configure(command: &mut CommandBuilder, agent: &AgentProfile) {
    super::add_model_arg(command, agent);
    super::add_agent_args(command, agent);
}

pub(super) fn fallback_candidates(_home: Option<&Path>) -> Vec<PathBuf> {
    Vec::new()
}
