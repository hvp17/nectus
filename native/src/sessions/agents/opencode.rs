use crate::models::AgentProfile;
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

pub(super) fn configure(
    command: &mut CommandBuilder,
    agent: &AgentProfile,
    session_id: &str,
    resume: bool,
    initial_prompt: Option<&str>,
    port: u16,
) {
    command.arg("--hostname");
    command.arg("127.0.0.1");
    command.arg("--port");
    command.arg(port.to_string());
    if resume {
        command.arg("--session");
        command.arg(session_id);
    } else {
        super::add_model_arg(command, agent);
    }
    super::add_agent_args(command, agent);
    if !resume {
        if let Some(prompt) = initial_prompt
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.arg("--prompt");
            command.arg(prompt);
        }
    }
}

pub(super) fn fallback_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = home {
        candidates.push(home.join(".opencode").join("bin").join("opencode"));
        candidates.push(home.join("bin").join("opencode"));
    }
    candidates
}
