use std::path::{Path, PathBuf};
use std::process::Command;

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

pub fn default_worktree_root(repo_path: &Path) -> PathBuf {
    let repo_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    let parent = repo_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{repo_name}-worktrees"))
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

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(branch_name)
        .arg(worktree_path)
        .output()
        .map_err(|error| format!("Failed to run git worktree add: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "git worktree add failed".into()
        } else {
            stderr
        })
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
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "git worktree remove failed".into()
        } else {
            stderr
        })
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
    use tempfile::tempdir;

    #[test]
    fn derives_sibling_worktree_root_from_repo_path() {
        let root = default_worktree_root(Path::new("/tmp/nectus"));

        assert_eq!(root, PathBuf::from("/tmp/nectus-worktrees"));
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
    fn rejects_non_git_folder() {
        let dir = tempdir().unwrap();

        assert!(validate_repo_path(dir.path()).is_err());
    }
}
