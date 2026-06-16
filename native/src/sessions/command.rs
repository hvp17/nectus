use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub(super) fn resolve_agent_command(command: &str) -> Result<PathBuf, String> {
    resolve_agent_command_in_env(command, &CommandSearchEnv::current())
}

struct CommandSearchEnv {
    path: OsString,
    home: Option<PathBuf>,
}

impl CommandSearchEnv {
    fn current() -> Self {
        Self {
            path: env::var_os("PATH").unwrap_or_default(),
            home: env::var_os("HOME").map(PathBuf::from),
        }
    }
}

fn resolve_agent_command_in_env(
    command: &str,
    search_env: &CommandSearchEnv,
) -> Result<PathBuf, String> {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return if is_executable_file(command_path) {
            Ok(command_path.to_path_buf())
        } else if command_path.exists() {
            Err(format!("Agent command is not executable: {command}"))
        } else {
            Err(format!("Agent command does not exist: {command}"))
        };
    }

    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Ok(path) = which::which_in(command, Some(&search_env.path), cwd) {
        return Ok(path);
    }

    for candidate in fallback_agent_candidates(command, search_env.home.as_deref()) {
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }

    let path_display = search_env.path.to_string_lossy();
    let fallback_display = fallback_agent_candidates(command, search_env.home.as_deref())
        .into_iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Unable to find `{command}` in PATH \"{path_display}\"{}",
        if fallback_display.is_empty() {
            String::new()
        } else {
            format!(" or known app locations: {fallback_display}")
        }
    ))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn fallback_agent_candidates(command: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = crate::process_util::third_party_bin_dirs(home)
        .into_iter()
        .map(|dir| dir.join(command))
        .collect::<Vec<_>>();
    match command {
        "codex" => {
            candidates.push(PathBuf::from(
                "/Applications/Codex.app/Contents/Resources/codex",
            ));
            if let Some(home) = home {
                candidates.push(
                    home.join("Applications")
                        .join("Codex.app")
                        .join("Contents")
                        .join("Resources")
                        .join("codex"),
                );
            }
        }
        "agy" => {
            if let Some(home) = home {
                candidates.push(home.join(".antigravity").join("bin").join("agy"));
            }
        }
        "opencode" => {
            if let Some(home) = home {
                candidates.push(home.join(".opencode").join("bin").join("opencode"));
                candidates.push(home.join("bin").join("opencode"));
            }
        }
        "claude" => {}
        _ => {}
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn resolves_command_from_path() {
        let dir = tempdir().unwrap();
        let executable = dir.path().join("test-agent");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let resolved = resolve_agent_command_in_env(
            "test-agent",
            &CommandSearchEnv {
                path: dir.path().as_os_str().to_owned(),
                home: None,
            },
        )
        .unwrap();

        assert_eq!(resolved, executable);
    }

    #[test]
    fn preserves_existing_explicit_command_path() {
        let dir = tempdir().unwrap();
        let executable = dir.path().join("agent");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            resolve_agent_command(executable.to_str().unwrap()).unwrap(),
            executable
        );
    }

    #[test]
    fn rejects_explicit_command_path_that_is_not_executable() {
        let dir = tempdir().unwrap();
        let executable = dir.path().join("agent");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o644)).unwrap();

        let error = resolve_agent_command(executable.to_str().unwrap()).unwrap_err();

        assert!(error.contains("Agent command is not executable"), "{error}");
    }

    #[test]
    fn resolves_command_from_user_local_bin_when_gui_path_is_minimal() {
        let home = tempdir().unwrap();
        let bin_dir = home.path().join(".local").join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let executable = bin_dir.join("claude");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let resolved = resolve_agent_command_in_env(
            "claude",
            &CommandSearchEnv {
                path: OsString::from("/usr/bin:/bin:/usr/sbin:/sbin"),
                home: Some(home.path().to_path_buf()),
            },
        )
        .unwrap();

        assert_eq!(resolved, executable);
    }
}
