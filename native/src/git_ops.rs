use crate::models::{DiffChangeKind, DiffFileEntry};
use crate::process_util::command_error;
use std::collections::HashMap;
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

/// Extract `(owner, repo)` from a git remote URL, handling the common GitHub
/// SSH (`git@github.com:owner/repo.git`) and HTTPS
/// (`https://github.com/owner/repo[.git]`) forms. Returns `None` for URLs we
/// can't confidently parse.
pub fn parse_remote_owner_repo(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("ssh://"))
        .or_else(|| url.strip_prefix("git://"))
        .unwrap_or(url);
    // Drop an optional `user@`, then split the host from the path on the first
    // `:` (SSH shorthand) or `/` (URL path).
    let after_user = without_scheme
        .split_once('@')
        .map(|(_, rest)| rest)
        .unwrap_or(without_scheme);
    let (_, path) = after_user.split_once([':', '/'])?;
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?.to_string();
    let repo = segments.next()?.to_string();
    Some((owner, repo))
}

/// Read the `(owner, repo)` of a repository's default remote.
pub fn remote_owner_repo(repo_path: &Path) -> Option<(String, String)> {
    let remote = default_remote(repo_path).ok()?;
    let output = git_output(
        repo_path,
        &["remote", "get-url", &remote],
        "Failed to read remote url",
    )
    .ok()?;
    parse_remote_owner_repo(String::from_utf8_lossy(&output.stdout).trim())
}

/// Fetch a pull request head into a local branch:
/// `git fetch --force origin pull/<n>/head:<branch>`. Works for fork PRs because
/// GitHub exposes `refs/pull/<n>/head` on the base repository's remote.
pub fn fetch_pull_request_ref(
    repo_path: &Path,
    number: i64,
    branch_name: &str,
) -> Result<(), String> {
    validate_branch_name(branch_name)?;
    let remote = default_remote(repo_path)?;
    let refspec = format!("pull/{number}/head:{branch_name}");
    git_output(
        repo_path,
        &["fetch", "--force", &remote, &refspec],
        "Failed to fetch pull request ref",
    )?;
    Ok(())
}

/// Add a worktree that checks out an existing local branch (e.g. a fetched PR
/// head). Unlike [`create_worktree`], this does not create a new branch from the
/// remote default — the branch must already exist.
pub fn create_worktree_at_ref(
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
        .arg(worktree_path)
        .arg(branch_name)
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

/// The base a worktree task is diffed against: a display label (e.g. `origin/main`)
/// and the merge-base commit the diff is computed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffBase {
    pub label: String,
    pub commit: String,
}

/// Resolve the base to diff a worktree branch against, using only local refs (no
/// network): the merge-base of `HEAD` and the repository's default branch
/// (`origin/HEAD`). Returns `None` when no base can be determined — for example a
/// repo without a remote-tracking default — and callers then diff against `HEAD`.
pub fn resolve_diff_base(path: &Path) -> Option<DiffBase> {
    let default = git_output(
        path,
        &["rev-parse", "--abbrev-ref", "origin/HEAD"],
        "Failed to resolve default branch",
    )
    .ok()?;
    let label = String::from_utf8_lossy(&default.stdout).trim().to_string();
    if label.is_empty() || label == "origin/HEAD" {
        return None;
    }

    let merge_base = git_output(
        path,
        &["merge-base", "HEAD", &label],
        "Failed to resolve merge base",
    )
    .ok()?;
    let commit = String::from_utf8_lossy(&merge_base.stdout)
        .trim()
        .to_string();
    if commit.is_empty() {
        return None;
    }

    Some(DiffBase { label, commit })
}

/// Summarize the files changed between `base` (or `HEAD` when `None`) and the
/// working tree, including untracked files. Tracked entries merge
/// `git diff --numstat` (line counts, binary) with `--name-status` (change kind);
/// untracked files are listed via `git ls-files` and read to count added lines.
/// Rename detection is disabled, so a rename appears as a delete + add.
pub fn diff_summary(path: &Path, base: Option<&str>) -> Result<Vec<DiffFileEntry>, String> {
    let base_ref = base.unwrap_or("HEAD");

    let numstat = git_output(
        path,
        &["diff", "--no-renames", "--numstat", "-z", base_ref],
        "Failed to compute diff stats",
    )?;
    let stats = parse_numstat(&String::from_utf8_lossy(&numstat.stdout));

    let name_status = git_output(
        path,
        &["diff", "--no-renames", "--name-status", "-z", base_ref],
        "Failed to compute diff status",
    )?;

    let mut files = Vec::new();
    for (change, file) in parse_name_status(&String::from_utf8_lossy(&name_status.stdout)) {
        let (additions, deletions, binary) = stats.get(&file).copied().unwrap_or((0, 0, false));
        files.push(DiffFileEntry {
            path: file,
            change,
            additions,
            deletions,
            binary,
        });
    }

    for file in untracked_files(path)? {
        let (additions, binary) = count_added_lines(&path.join(&file));
        files.push(DiffFileEntry {
            path: file,
            change: DiffChangeKind::Untracked,
            additions,
            deletions: 0,
            binary,
        });
    }

    Ok(files)
}

/// The unified patch for a single file in the task diff. Tracked files diff
/// against `base` (or `HEAD`); untracked files are diffed against `/dev/null` with
/// `--no-index`, whose exit code 1 ("differences found") is expected here.
pub fn diff_file(path: &Path, base: Option<&str>, file: &str) -> Result<String, String> {
    if is_untracked(path, file) {
        return untracked_patch(path, file);
    }
    let base_ref = base.unwrap_or("HEAD");
    let output = git_output(
        path,
        &["diff", "--no-renames", base_ref, "--", file],
        "Failed to compute file diff",
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Parse `git diff --no-renames --numstat -z` output into per-path
/// `(additions, deletions, binary)`. Every record is a single
/// `<add>\t<del>\t<path>` token; binary files report `-` for the counts.
fn parse_numstat(output: &str) -> HashMap<String, (u32, u32, bool)> {
    let mut stats = HashMap::new();
    for token in output.split('\0') {
        if token.is_empty() {
            continue;
        }
        let mut fields = token.splitn(3, '\t');
        let add = fields.next().unwrap_or("");
        let del = fields.next().unwrap_or("");
        let Some(path) = fields.next().filter(|path| !path.is_empty()) else {
            continue;
        };
        let binary = add == "-";
        stats.insert(
            path.to_string(),
            (add.parse().unwrap_or(0), del.parse().unwrap_or(0), binary),
        );
    }
    stats
}

/// Parse `git diff --no-renames --name-status -z` output into `(change, path)`
/// pairs. Every record is a single `<status>\0<path>` pair.
fn parse_name_status(output: &str) -> Vec<(DiffChangeKind, String)> {
    let mut entries = Vec::new();
    let mut tokens = output.split('\0').filter(|token| !token.is_empty());
    while let Some(status) = tokens.next() {
        let Some(path) = tokens.next() else { break };
        let change = match status.chars().next() {
            Some('A') => DiffChangeKind::Added,
            Some('D') => DiffChangeKind::Deleted,
            // M (modify), T (type change), and anything unexpected.
            _ => DiffChangeKind::Modified,
        };
        entries.push((change, path.to_string()));
    }
    entries
}

/// List untracked, non-ignored files relative to `path`.
fn untracked_files(path: &Path) -> Result<Vec<String>, String> {
    let output = git_output(
        path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
        "Failed to list untracked files",
    )?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .split('\0')
        .filter(|file| !file.is_empty())
        .map(str::to_string)
        .collect())
}

/// Count the added lines of a new (untracked) file, returning `(lines, binary)`.
/// A file is treated as binary when its bytes contain a NUL.
fn count_added_lines(path: &Path) -> (u32, bool) {
    let Ok(bytes) = std::fs::read(path) else {
        return (0, false);
    };
    if bytes.contains(&0) {
        return (0, true);
    }
    if bytes.is_empty() {
        return (0, false);
    }
    let newlines = bytes.iter().filter(|&&byte| byte == b'\n').count();
    let trailing = usize::from(bytes.last() != Some(&b'\n'));
    ((newlines + trailing) as u32, false)
}

fn is_untracked(path: &Path, file: &str) -> bool {
    let Ok(output) = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["ls-files", "--others", "--exclude-standard", "--", file])
        .output()
    else {
        return false;
    };
    output.status.success() && !output.stdout.is_empty()
}

fn untracked_patch(path: &Path, file: &str) -> Result<String, String> {
    // `git diff --no-index` exits 1 when the inputs differ, which is always the
    // case here (one side is /dev/null). Treat exit codes 0 and 1 as success.
    let output = Command::new("git")
        .current_dir(path)
        .args(["diff", "--no-index", "--", "/dev/null", file])
        .output()
        .map_err(|error| format!("Failed to compute new-file diff: {error}"))?;
    match output.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
        _ => Err(command_error(&output, "git diff --no-index failed")),
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

    #[test]
    fn parses_owner_and_repo_from_remote_urls() {
        for url in [
            "git@github.com:hvp17/nectus.git",
            "https://github.com/hvp17/nectus.git",
            "https://github.com/hvp17/nectus",
            "ssh://git@github.com/hvp17/nectus.git",
            "https://github.com/hvp17/nectus/",
        ] {
            assert_eq!(
                parse_remote_owner_repo(url),
                Some(("hvp17".to_string(), "nectus".to_string())),
                "failed to parse {url}"
            );
        }
    }

    #[test]
    fn rejects_unparseable_remote_urls() {
        assert_eq!(parse_remote_owner_repo(""), None);
        assert_eq!(parse_remote_owner_repo("not-a-url"), None);
        assert_eq!(parse_remote_owner_repo("https://github.com/owner-only"), None);
    }

    #[test]
    fn fetches_pull_request_head_into_a_worktree() {
        let dir = tempdir().unwrap();
        let remote_dir = dir.path().join("remote.git");
        let seed_dir = dir.path().join("seed");
        let local_dir = dir.path().join("local");
        let worktree_path = dir.path().join("pr-review-1");

        Command::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .arg(&remote_dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["init", "--initial-branch=main"])
            .arg(&seed_dir)
            .output()
            .unwrap();
        run_git(&seed_dir, &["config", "user.email", "test@example.com"]);
        run_git(&seed_dir, &["config", "user.name", "Test User"]);
        run_git(
            &seed_dir,
            &["remote", "add", "origin", &remote_dir.to_string_lossy()],
        );
        fs::write(seed_dir.join("base.txt"), "base\n").unwrap();
        run_git(&seed_dir, &["add", "base.txt"]);
        run_git(&seed_dir, &["commit", "-m", "Base"]);
        run_git(&seed_dir, &["push", "-u", "origin", "main"]);

        // Simulate a PR head ref like GitHub exposes at refs/pull/<n>/head.
        run_git(&seed_dir, &["checkout", "-b", "feature"]);
        fs::write(seed_dir.join("base.txt"), "from-pull-request\n").unwrap();
        run_git(&seed_dir, &["commit", "-am", "PR change"]);
        run_git(&seed_dir, &["push", "origin", "HEAD:refs/pull/1/head"]);

        Command::new("git")
            .arg("clone")
            .arg(&remote_dir)
            .arg(&local_dir)
            .output()
            .unwrap();

        fetch_pull_request_ref(&local_dir, 1, "pr-review-1").unwrap();
        create_worktree_at_ref(&local_dir, &worktree_path, "pr-review-1").unwrap();

        assert_eq!(
            fs::read_to_string(worktree_path.join("base.txt")).unwrap(),
            "from-pull-request\n"
        );
    }

    fn init_repo(repo: &Path) {
        fs::create_dir_all(repo).unwrap();
        run_git(repo, &["init", "--initial-branch=main"]);
        run_git(repo, &["config", "user.email", "test@example.com"]);
        run_git(repo, &["config", "user.name", "Test User"]);
    }

    fn head_commit(repo: &Path) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn diff_summary_reports_working_tree_changes() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        init_repo(repo);
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        run_git(repo, &["add", "a.txt"]);
        run_git(repo, &["commit", "-m", "base"]);

        // Uncommitted modification plus a brand-new untracked file.
        fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(repo.join("new.txt"), "alpha\nbeta\n").unwrap();

        let files = diff_summary(repo, None).unwrap();
        let by_path: HashMap<&str, &DiffFileEntry> =
            files.iter().map(|file| (file.path.as_str(), file)).collect();

        let modified = by_path.get("a.txt").expect("a.txt in diff");
        assert_eq!(modified.change, DiffChangeKind::Modified);
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 0);

        let untracked = by_path.get("new.txt").expect("new.txt in diff");
        assert_eq!(untracked.change, DiffChangeKind::Untracked);
        assert_eq!(untracked.additions, 2);
        assert!(!untracked.binary);
    }

    #[test]
    fn diff_summary_reports_committed_and_uncommitted_against_base() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        init_repo(repo);
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        run_git(repo, &["add", "a.txt"]);
        run_git(repo, &["commit", "-m", "base"]);
        let base = head_commit(repo);

        // A committed change on top of the base...
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        fs::write(repo.join("b.txt"), "added\n").unwrap();
        run_git(repo, &["add", "."]);
        run_git(repo, &["commit", "-m", "second"]);
        // ...plus an uncommitted change in the working tree.
        fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();

        let files = diff_summary(repo, Some(&base)).unwrap();
        let by_path: HashMap<&str, &DiffFileEntry> =
            files.iter().map(|file| (file.path.as_str(), file)).collect();

        let modified = by_path.get("a.txt").expect("a.txt in diff");
        assert_eq!(modified.change, DiffChangeKind::Modified);
        // Both the committed and the uncommitted additions, relative to the base.
        assert_eq!(modified.additions, 2);
        assert_eq!(by_path.get("b.txt").expect("b.txt in diff").change, DiffChangeKind::Added);
    }

    #[test]
    fn resolve_diff_base_finds_local_merge_base() {
        let dir = tempdir().unwrap();
        let remote_dir = dir.path().join("remote.git");
        let seed_dir = dir.path().join("seed");
        let local_dir = dir.path().join("local");

        Command::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .arg(&remote_dir)
            .output()
            .unwrap();
        init_repo(&seed_dir);
        run_git(
            &seed_dir,
            &["remote", "add", "origin", &remote_dir.to_string_lossy()],
        );
        fs::write(seed_dir.join("base.txt"), "base\n").unwrap();
        run_git(&seed_dir, &["add", "base.txt"]);
        run_git(&seed_dir, &["commit", "-m", "base"]);
        run_git(&seed_dir, &["push", "-u", "origin", "main"]);

        Command::new("git")
            .arg("clone")
            .arg(&remote_dir)
            .arg(&local_dir)
            .output()
            .unwrap();
        run_git(&local_dir, &["config", "user.email", "test@example.com"]);
        run_git(&local_dir, &["config", "user.name", "Test User"]);
        let base = head_commit(&local_dir);

        // Branch off and commit so HEAD diverges from the default branch.
        run_git(&local_dir, &["checkout", "-b", "feature"]);
        fs::write(local_dir.join("base.txt"), "changed\n").unwrap();
        run_git(&local_dir, &["commit", "-am", "feature change"]);

        let resolved = resolve_diff_base(&local_dir).expect("base resolved");
        assert_eq!(resolved.label, "origin/main");
        assert_eq!(resolved.commit, base);
    }

    #[test]
    fn diff_file_returns_patch_for_tracked_and_untracked() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        init_repo(repo);
        fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        run_git(repo, &["add", "a.txt"]);
        run_git(repo, &["commit", "-m", "base"]);

        fs::write(repo.join("a.txt"), "one\nTWO\n").unwrap();
        fs::write(repo.join("new.txt"), "fresh\n").unwrap();

        let tracked = diff_file(repo, None, "a.txt").unwrap();
        assert!(tracked.contains("@@"), "tracked patch has a hunk header");
        assert!(tracked.contains("-two"), "tracked patch shows the removed line");
        assert!(tracked.contains("+TWO"), "tracked patch shows the added line");

        let untracked = diff_file(repo, None, "new.txt").unwrap();
        assert!(untracked.contains("new.txt"), "untracked patch names the file");
        assert!(untracked.contains("+fresh"), "untracked patch shows the new line");
    }
}
