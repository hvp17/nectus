use crate::models::{AgentKind, AgentProfile};
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

mod claude;
mod codex;
mod gemini;

pub(super) fn configure_agent_command(
    command: &mut CommandBuilder,
    agent: &AgentProfile,
    session_id: &str,
    resume: bool,
) {
    match agent.agent_kind {
        AgentKind::Codex => codex::configure(command, agent, session_id, resume),
        AgentKind::Claude => claude::configure(command, agent, session_id, resume),
        AgentKind::Gemini => gemini::configure(command, agent),
        AgentKind::Custom => command.args(&agent.args),
    }
}

pub(super) fn fallback_agent_candidates(command: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = user_bin_candidates(command, home);
    match command {
        "codex" => candidates.extend(codex::fallback_candidates(home)),
        "claude" => candidates.extend(claude::fallback_candidates(home)),
        "gemini" => candidates.extend(gemini::fallback_candidates(home)),
        _ => {}
    }
    candidates
}

fn add_model_arg(command: &mut CommandBuilder, agent: &AgentProfile) {
    if let Some(model) = agent
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--model");
        command.arg(model);
    }
}

fn add_agent_args(command: &mut CommandBuilder, agent: &AgentProfile) {
    command.args(&agent.args);
}

fn user_bin_candidates(command: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = home {
        candidates.push(home.join(".local").join("bin").join(command));
        candidates.push(home.join(".cargo").join("bin").join(command));
        candidates.push(home.join(".npm-global").join("bin").join(command));
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/local/sbin",
        "/opt/homebrew/sbin",
    ] {
        candidates.push(PathBuf::from(dir).join(command));
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn agent(agent_kind: AgentKind, model: Option<&str>, args: &[&str]) -> AgentProfile {
        AgentProfile {
            id: 1,
            name: agent_kind.as_str().to_string(),
            agent_kind,
            command: agent_kind.as_str().to_string(),
            model: model.map(str::to_string),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: Default::default(),
            created_at: "2026-05-16T00:00:00.000Z".to_string(),
            updated_at: "2026-05-16T00:00:00.000Z".to_string(),
        }
    }

    fn argv(command: &CommandBuilder) -> Vec<String> {
        command
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn configures_codex_resume_without_model_flag() {
        let mut command = CommandBuilder::new(OsString::from("codex"));
        configure_agent_command(
            &mut command,
            &agent(AgentKind::Codex, Some("gpt-5.3-codex"), &["--full-auto"]),
            "session-1",
            true,
        );

        assert_eq!(
            argv(&command),
            ["codex", "resume", "--full-auto", "session-1"]
        );
    }

    #[test]
    fn configures_claude_new_session_id_then_hook_settings() {
        let mut command = CommandBuilder::new(OsString::from("claude"));
        configure_agent_command(
            &mut command,
            &agent(
                AgentKind::Claude,
                Some("sonnet"),
                &["--dangerously-skip-permissions"],
            ),
            "session-2",
            false,
        );

        let argv = argv(&command);
        assert_eq!(
            argv[..6],
            [
                "claude",
                "--model",
                "sonnet",
                "--dangerously-skip-permissions",
                "--session-id",
                "session-2"
            ]
        );
        // The session id is followed by the inline hook settings overlay.
        assert_eq!(argv[6], "--settings");
        let settings: serde_json::Value =
            serde_json::from_str(&argv[7]).expect("hook settings must be valid JSON");
        assert!(settings["hooks"]["Stop"].is_array());
        assert!(settings["hooks"]["Notification"].is_array());
        assert_eq!(argv.len(), 8);
    }

    #[test]
    fn configures_gemini_model_and_custom_args_only() {
        let mut command = CommandBuilder::new(OsString::from("gemini"));
        configure_agent_command(
            &mut command,
            &agent(AgentKind::Gemini, Some("gemini-pro"), &["--yolo"]),
            "unused-session",
            false,
        );

        assert_eq!(
            argv(&command),
            ["gemini", "--model", "gemini-pro", "--yolo"]
        );
    }
}
