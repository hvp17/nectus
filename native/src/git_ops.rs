use crate::process_util::command_error;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn git_output(repo_path: &Path, args: &[&str], failure_message: &str) -> Result<Output, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("{failure_message}: {error}"))?;

    if output.status.success() {
        Ok(output)
    } else {
        Err(command_error(&output, failure_message))
    }
}

pub fn validate_repo_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("Repository path does not exist".into());
    }
    if !path.is_dir() {
        return Err("Repository path must be a directory".into());
    }

    let output = Command::new("git")
        .args([
            "-C",
            &path.to_string_lossy(),
            "rev-parse",
            "--show-toplevel",
        ])
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err("Path is not inside a git repository".into())
    }
}

pub fn default_worktree_root_with_pattern(repo_path: &Path, pattern: &str) -> PathBuf {
    let repo_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    let value = pattern.replace("{repoName}", repo_name);
    let path = PathBuf::from(value);
    if path.is_absolute() {
        normalize_path(path)
    } else {
        normalize_path(repo_path.join(path))
    }
}

fn normalize_path(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

pub fn validate_branch_name(branch_name: &str) -> Result<(), String> {
    let trimmed = branch_name.trim();
    if trimmed.is_empty() {
        return Err("Branch name is required".into());
    }
    if trimmed.starts_with('-') {
        return Err("Branch name cannot start with '-'".into());
    }
    if trimmed.contains("..")
        || trimmed.contains('\\')
        || trimmed.contains('~')
        || trimmed.contains('^')
        || trimmed.contains(':')
        || trimmed.contains('?')
        || trimmed.contains('*')
        || trimmed.contains('[')
        || trimmed.contains("//")
        || trimmed.ends_with('/')
        || trimmed.ends_with(".lock")
        || trimmed.chars().any(char::is_whitespace)
    {
        return Err("Branch name contains unsupported characters".into());
    }

    Ok(())
}

fn default_remote(repo_path: &Path) -> Result<String, String> {
    let output = git_output(repo_path, &["remote"], "Failed to list git remotes")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let remotes = stdout
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty());

    let mut first_remote = None;
    for remote in remotes {
        if remote == "origin" {
            return Ok(remote.to_string());
        }
        first_remote.get_or_insert_with(|| remote.to_string());
    }

    first_remote.ok_or_else(|| "Repository has no git remotes".to_string())
}

fn remote_default_branch(repo_path: &Path, remote: &str) -> Result<String, String> {
    let output = git_output(
        repo_path,
        &["ls-remote", "--symref", remote, "HEAD"],
        "Failed to resolve remote default branch",
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
            if let Some(branch) = rest.strip_suffix("\tHEAD") {
                return Ok(branch.to_string());
            }
        }
    }

    Err(format!(
        "Could not determine default branch for remote '{remote}'"
    ))
}

fn fetch_remote(repo_path: &Path, remote: &str) -> Result<(), String> {
    git_output(
        repo_path,
        &["fetch", "--prune", remote],
        "Failed to fetch latest remote refs",
    )?;
    Ok(())
}

pub fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
) -> Result<(), String> {
    validate_branch_name(branch_name)?;
    if worktree_path.exists() {
        return Err("Worktree path already exists".into());
    }

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create worktree parent folder: {error}"))?;
    }

    let remote = default_remote(repo_path)?;
    let default_branch = remote_default_branch(repo_path, &remote)?;
    fetch_remote(repo_path, &remote)?;
    let base_ref = format!("refs/remotes/{remote}/{default_branch}");

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("--no-track")
        .arg("-b")
        .arg(branch_name)
        .arg(worktree_path)
        .arg(&base_ref)
        .output()
        .map_err(|error| format!("Failed to run git worktree add: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output, "git worktree add failed"))
    }
}

pub fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<(), String> {
    if !worktree_path.exists() {
        return Ok(());
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(worktree_path)
        .output()
        .map_err(|error| format!("Failed to run git worktree remove: {error}"))?;

    if output.status.success() {
        // Also try to remove the parent directory if it's empty (the one we created in create_worktree)
        if let Some(parent) = worktree_path.parent() {
            if parent.exists() {
                let _ = std::fs::remove_dir(parent); // Ignore error if not empty
            }
        }
        Ok(())
    } else {
        Err(command_error(&output, "git worktree remove failed"))
    }
}

pub fn is_dirty(path: &Path) -> bool {
    let Ok(output) = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["status", "--porcelain"])
        .output()
    else {
        return false;
    };

    output.status.success() && !output.stdout.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn run_git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap_or_else(|error| panic!("failed to run git {args:?}: {error}"));

        assert!(
            output.status.success(),
            "git {args:?} failed\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn derives_sibling_worktree_root_from_repo_path() {
        let root =
            default_worktree_root_with_pattern(Path::new("/tmp/nectus"), "../{repoName}-worktrees");

        assert_eq!(root, PathBuf::from("/tmp/nectus-worktrees"));
    }

    #[test]
    fn derives_worktree_root_from_pattern() {
        let root =
            default_worktree_root_with_pattern(Path::new("/tmp/nectus"), "../worktrees/{repoName}");

        assert_eq!(root, PathBuf::from("/tmp/worktrees/nectus"));
    }

    #[test]
    fn rejects_unsafe_branch_names() {
        for value in [
            "",
            "-bad",
            "feature bad",
            "main..dev",
            "x:y",
            "x.lock",
            "x//y",
        ] {
            assert!(
                validate_branch_name(value).is_err(),
                "{value} should be rejected"
            );
        }
    }

    #[test]
    fn accepts_common_branch_names() {
        for value in ["feature/settings", "fix-auth", "user/TOM-123"] {
            assert!(
                validate_branch_name(value).is_ok(),
                "{value} should be accepted"
            );
        }
    }

    #[test]
    fn creates_worktree_from_latest_remote_default_branch() {
        let dir = tempdir().unwrap();
        let remote_dir = dir.path().join("remote.git");
        let seed_dir = dir.path().join("seed");
        let local_dir = dir.path().join("local");
        let worktree_path = dir.path().join("worktree");

        Command::new("git")
            .args(["init", "--bare", "--initial-branch=trunk"])
            .arg(&remote_dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["init", "--initial-branch=trunk"])
            .arg(&seed_dir)
            .output()
            .unwrap();
        run_git(&seed_dir, &["config", "user.email", "test@example.com"]);
        run_git(&seed_dir, &["config", "user.name", "Test User"]);
        run_git(
            &seed_dir,
            &["remote", "add", "origin", &remote_dir.to_string_lossy()],
        );

        fs::write(seed_dir.join("value.txt"), "local-stale\n").unwrap();
        run_git(&seed_dir, &["add", "value.txt"]);
        run_git(&seed_dir, &["commit", "-m", "Initial"]);
        run_git(&seed_dir, &["push", "-u", "origin", "trunk"]);

        Command::new("git")
            .arg("clone")
            .arg(&remote_dir)
            .arg(&local_dir)
            .output()
            .unwrap();

        fs::write(seed_dir.join("value.txt"), "remote-latest\n").unwrap();
        run_git(&seed_dir, &["commit", "-am", "Update remote default"]);
        run_git(&seed_dir, &["push"]);

        create_worktree(&local_dir, &worktree_path, "feature/latest").unwrap();

        assert_eq!(
            fs::read_to_string(worktree_path.join("value.txt")).unwrap(),
            "remote-latest\n"
        );
    }

    #[test]
    fn rejects_non_git_folder() {
        let dir = tempdir().unwrap();

        assert!(validate_repo_path(dir.path()).is_err());
    }
}
