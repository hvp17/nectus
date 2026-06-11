use crate::process_util::command_error;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::mpsc;
use std::time::Duration;

mod diff;
pub use diff::*;

fn git_output(repo_path: &Path, args: &[&str], failure_message: &str) -> Result<Output, String> {
    git_output_allowing_codes(repo_path, args, &[], failure_message)
}

fn git_command(repo_path: &Path) -> Command {
    let mut command = Command::new(crate::process_util::resolve_executable("git"));
    // A macOS app launched from Finder/Dock inherits a minimal environment: no
    // SSH_AUTH_SOCK (the ssh-agent socket), none of the user's exported git/ssh
    // config, and no controlling terminal. Network git — `git ls-remote`/`git
    // fetch` during worktree creation — would then fail to authenticate against a
    // private remote and *hang forever* waiting on a passphrase/credential prompt
    // at a tty that doesn't exist. Because worktree creation runs under the global
    // DB lock, that hang freezes the whole app (the create-task crash). Seed the
    // captured login-shell env so auth works exactly as it does in a terminal
    // (SSH_AUTH_SOCK + the user's config), then force non-interactive auth so any
    // remaining gap fails fast with a clear error instead of hanging.
    let mut has_git_ssh_command = false;
    for (key, value) in crate::process_util::login_shell_environment() {
        if key == "GIT_SSH_COMMAND" {
            has_git_ssh_command = true;
        }
        command.env(key, value);
    }
    command.env("PATH", crate::process_util::augmented_path());
    // git's own prompts (HTTPS username/password) and Git Credential Manager's GUI
    // popups: disabled so they error instead of blocking.
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GCM_INTERACTIVE", "never");
    // ssh: fail fast rather than prompt for a passphrase/host-key confirmation.
    // Respect a user-provided GIT_SSH_COMMAND (their terminal already works with
    // it); otherwise install a batch-mode default with a bounded connect timeout.
    if !has_git_ssh_command {
        command.env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o ConnectTimeout=10",
        );
    }
    command.arg("-C").arg(repo_path);
    command
}

/// Like [`git_output`] but also treats the listed non-zero exit codes as success.
/// `git diff --no-index` exits 1 ("differences found"), expected when diffing an
/// untracked file against `/dev/null`.
fn git_output_allowing_codes(
    repo_path: &Path,
    args: &[&str],
    allowed_codes: &[i32],
    failure_message: &str,
) -> Result<Output, String> {
    let output = git_command(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("{failure_message}: {error}"))?;

    if output.status.success()
        || output
            .status
            .code()
            .is_some_and(|code| allowed_codes.contains(&code))
    {
        Ok(output)
    } else {
        Err(command_error(&output, failure_message))
    }
}

fn prepare_worktree_path(worktree_path: &Path) -> Result<(), String> {
    if worktree_path.exists() {
        return Err("Worktree path already exists".into());
    }

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create worktree parent folder: {error}"))?;
    }
    Ok(())
}

fn run_git_worktree_add(
    repo_path: &Path,
    worktree_path: &Path,
    options: &[&str],
    checkout_ref: &str,
) -> Result<(), String> {
    let output = git_command(repo_path)
        .arg("worktree")
        .arg("add")
        .args(options)
        .arg(worktree_path)
        .arg(checkout_ref)
        .output()
        .map_err(|error| format!("Failed to run git worktree add: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&output, "git worktree add failed"))
    }
}

pub fn validate_repo_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("Repository path does not exist".into());
    }
    if !path.is_dir() {
        return Err("Repository path must be a directory".into());
    }

    // Route through git_output so the repo path is passed as an OsStr (no lossy
    // conversion) and `-C` is used consistently.
    git_output(
        path,
        &["rev-parse", "--show-toplevel"],
        "Path is not inside a git repository",
    )
    .map(|_| ())
}

pub fn default_worktree_root_with_pattern(repo_path: &Path, pattern: &str) -> PathBuf {
    resolve_worktree_root(
        repo_path,
        pattern,
        std::env::var_os("HOME").map(PathBuf::from).as_deref(),
    )
}

/// Resolve a worktree-root pattern against a repo path, expanding a leading `~`
/// to `home`. Split out from [`default_worktree_root_with_pattern`] so the home
/// directory can be injected in tests. A pattern starting with `~`/`~/` anchors
/// at the home directory; an absolute pattern is taken as-is; anything else is
/// resolved relative to the repo path (the historical behavior).
fn resolve_worktree_root(repo_path: &Path, pattern: &str, home: Option<&Path>) -> PathBuf {
    let repo_name = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    let value = pattern.replace("{repoName}", repo_name);
    let path = expand_home(&value, home);
    if path.is_absolute() {
        normalize_path(path)
    } else {
        normalize_path(repo_path.join(path))
    }
}

/// Expand a leading `~` (bare or `~/…`) to the given home directory. Without a
/// home, or for any other input, the value is returned verbatim.
fn expand_home(value: &str, home: Option<&Path>) -> PathBuf {
    match home {
        Some(home) if value == "~" => home.to_path_buf(),
        Some(home) => match value.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(value),
        },
        None => PathBuf::from(value),
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

/// Resolve the remote's default branch, preferring a **local, no-network** read
/// of `refs/remotes/<remote>/HEAD` (the symref `git clone` records). Only falls
/// back to a network `ls-remote --symref` when that local symref is missing
/// (e.g. a CI clone that didn't set it). The network `ls-remote` was the single
/// slowest step in worktree creation — seconds, sometimes tens of seconds — so
/// skipping it in the common case is the biggest latency win.
fn resolve_default_branch(repo_path: &Path, remote: &str) -> Result<String, String> {
    if let Some(branch) = local_default_branch(repo_path, remote) {
        return Ok(branch);
    }
    remote_default_branch(repo_path, remote)
}

/// Read `refs/remotes/<remote>/HEAD` locally and return the bare branch name
/// (e.g. `master`). `None` when the symref is unset — `rev-parse --abbrev-ref`
/// then echoes the input (`origin/HEAD`) back, which we treat as missing.
fn local_default_branch(repo_path: &Path, remote: &str) -> Option<String> {
    let symbolic = format!("{remote}/HEAD");
    let output = git_output(
        repo_path,
        &["rev-parse", "--abbrev-ref", &symbolic],
        "Failed to read local default branch",
    )
    .ok()?;
    let label = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if label.is_empty() || label == symbolic {
        return None;
    }
    label
        .strip_prefix(&format!("{remote}/"))
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
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

/// Fetch **only the default branch, without tags** — far cheaper than the old
/// `fetch --prune` that pulled every branch and every tag on these large repos
/// (the dominant cost after `ls-remote`). The remote's configured refspec still
/// updates `refs/remotes/<remote>/<branch>`, which the worktree is based on, and
/// subsequent fetches of the same branch are incremental (only new objects).
fn fetch_default_branch(repo_path: &Path, remote: &str, branch: &str) -> Result<(), String> {
    git_output(
        repo_path,
        &["fetch", "--no-tags", remote, branch],
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
    prepare_worktree_path(worktree_path)?;

    // Step-by-step timed tracing so the Diagnostics panel pinpoints a slow/stuck
    // step: a "starting" line with no matching "done" line is the one that stuck.
    let remote = default_remote(repo_path)?;
    tracing::info!(repo = %repo_path.display(), %remote, branch = %branch_name, "create_worktree: resolving default branch");
    let started = std::time::Instant::now();
    let default_branch = resolve_default_branch(repo_path, &remote)?;
    tracing::info!(%default_branch, elapsed_ms = started.elapsed().as_millis() as u64, "create_worktree: resolved default branch; fetching it (git fetch --no-tags <branch>)");
    let started = std::time::Instant::now();
    fetch_default_branch(repo_path, &remote, &default_branch)?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        "create_worktree: fetch done; adding worktree (git worktree add)"
    );
    let base_ref = format!("refs/remotes/{remote}/{default_branch}");
    let started = std::time::Instant::now();
    run_git_worktree_add(
        repo_path,
        worktree_path,
        &["--no-track", "-b", branch_name],
        &base_ref,
    )?;
    tracing::info!(worktree = %worktree_path.display(), elapsed_ms = started.elapsed().as_millis() as u64, "create_worktree: worktree add done");
    Ok(())
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
    prepare_worktree_path(worktree_path)?;
    run_git_worktree_add(repo_path, worktree_path, &[], branch_name)
}

/// Stable error returned when a non-forced [`remove_worktree`] would discard a
/// worktree that still has uncommitted work. App-controlled (not git's localized
/// text) so the UI can recognise it and offer an explicit confirmation.
pub const WORKTREE_HAS_CHANGES: &str =
    "This task's worktree has uncommitted changes that deleting it would discard.";

/// Remove a worktree and prune its (now-empty) parent folder. With `force`,
/// `git worktree remove --force` discards modified/untracked files; without it,
/// a worktree carrying uncommitted work is preserved and [`WORKTREE_HAS_CHANGES`]
/// is returned so the caller can confirm before destroying user work.
pub fn remove_worktree(repo_path: &Path, worktree_path: &Path, force: bool) -> Result<(), String> {
    if !worktree_path.exists() {
        return Ok(());
    }
    if !force && is_dirty(worktree_path) {
        return Err(WORKTREE_HAS_CHANGES.to_string());
    }

    let mut command = git_command(repo_path);
    command.arg("worktree").arg("remove");
    if force {
        command.arg("--force");
    }
    let output = command
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

/// Delete a local branch, tolerating one that no longer exists. Used to clean up
/// the ephemeral `nectus-pr-review-*` branches a PR-review worktree checks out, so
/// they don't accumulate after every review.
pub fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<(), String> {
    let output = git_command(repo_path)
        .args(["branch", "-D", branch_name])
        .output()
        .map_err(|error| format!("Failed to run git branch -D: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    // A missing branch is fine — the caller just wants it gone.
    if String::from_utf8_lossy(&output.stderr).contains("not found") {
        return Ok(());
    }
    Err(command_error(&output, "git branch -D failed"))
}

/// Prune stale worktree admin entries (`git worktree prune`). After a worktree
/// directory is gone — whether `git worktree remove` cleaned it or it was deleted
/// out-of-band — git can leave a dangling entry under `.git/worktrees/<name>`
/// that clutters `git worktree list` and can block re-creating a same-named path.
/// Best-effort: a prune failure never blocks task deletion.
pub fn prune_worktrees(repo_path: &Path) {
    let _ = git_command(repo_path).args(["worktree", "prune"]).output();
}

/// Whether every commit on `branch` is already present on some remote — i.e.
/// deleting the local branch would lose nothing.
#[cfg(test)]
fn branch_fully_pushed(repo_path: &Path, branch: &str) -> bool {
    git_output(
        repo_path,
        &["rev-list", "--count", branch, "--not", "--remotes"],
        "Failed to count unpushed commits",
    )
    .ok()
    .and_then(|output| {
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .ok()
    })
    .map(|unpushed| unpushed == 0)
    .unwrap_or(false)
}

/// Clean up a task's branch when its worktree is removed, so `task-*` branches
/// don't pile up. Always deletes (force `-D`): deleting a task discards its
/// branch, including any unpushed commits — the delete already warns and gates on
/// the worktree's *uncommitted* changes via [`remove_worktree`]. Best-effort: a
/// missing branch, or one still checked out elsewhere, is tolerated and never
/// fails the surrounding delete.
pub fn cleanup_task_branch(repo_path: &Path, branch: &str) {
    let _ = delete_branch(repo_path, branch);
}

/// Max time to wait for `git status` before treating a worktree as clean. A
/// healthy status returns well under this even on a large repo; the bound exists
/// only so a pathological status — e.g. a `core.fsmonitor`/Watchman hook that
/// hangs in a GUI-launched app's minimal environment — can never wedge the
/// caller, and crucially never the global DB lock.
const IS_DIRTY_TIMEOUT: Duration = Duration::from_secs(10);

pub fn is_dirty(path: &Path) -> bool {
    // Run `git status` on a worker thread and wait at most IS_DIRTY_TIMEOUT. On
    // timeout we report "clean" and let the worker finish (or die with the
    // process) rather than block — a stuck git must never hold up the app. This
    // is the safe default: the only place that acts on dirtiness, deleting a
    // worktree, still has git's own `git worktree remove` refusal as a backstop.
    let (tx, rx) = mpsc::channel();
    let probe_path = path.to_path_buf();
    std::thread::spawn(move || {
        let dirty = git_output(
            &probe_path,
            &["status", "--porcelain"],
            "Failed to check worktree status",
        )
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(false);
        let _ = tx.send(dirty);
    });
    match rx.recv_timeout(IS_DIRTY_TIMEOUT) {
        Ok(dirty) => dirty,
        Err(_) => {
            tracing::warn!(
                path = %path.display(),
                "git status timed out; treating worktree as clean (check core.fsmonitor)"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DiffChangeKind, DiffFileEntry};
    use std::collections::HashMap;
    use std::ffi::{OsStr, OsString};
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
    fn git_command_uses_resolved_binary_and_augmented_path() {
        let dir = tempdir().unwrap();
        let command = git_command(dir.path());
        let expected_program = crate::process_util::resolve_executable("git");
        let expected_path = crate::process_util::augmented_path();

        assert_eq!(command.get_program(), expected_program.as_os_str());

        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(args, &[OsStr::new("-C"), dir.path().as_os_str()]);

        let path_env = command
            .get_envs()
            .find_map(|(key, value)| (key == OsStr::new("PATH")).then_some(value))
            .flatten();
        assert_eq!(path_env, Some(expected_path.as_os_str()));
    }

    #[test]
    fn git_command_forces_non_interactive_auth() {
        // A GUI-launched app has no tty; without these guards network git
        // (worktree-creation fetch/ls-remote) hangs forever on a credential prompt,
        // freezing the app under the global DB lock. They must always be set.
        let dir = tempdir().unwrap();
        let command = git_command(dir.path());
        let env = |name: &str| {
            command
                .get_envs()
                .find_map(|(key, value)| (key == OsStr::new(name)).then_some(value))
                .flatten()
                .map(OsStr::to_os_string)
        };

        assert_eq!(env("GIT_TERMINAL_PROMPT"), Some(OsString::from("0")));
        assert_eq!(env("GCM_INTERACTIVE"), Some(OsString::from("never")));
        let ssh = env("GIT_SSH_COMMAND").expect("GIT_SSH_COMMAND is set");
        assert!(
            ssh.to_string_lossy().contains("BatchMode=yes"),
            "ssh must run in batch mode, got {ssh:?}"
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
    fn expands_leading_tilde_to_home() {
        let root = resolve_worktree_root(
            Path::new("/tmp/nectus"),
            "~/.nectus/worktrees/{repoName}",
            Some(Path::new("/Users/alice")),
        );

        assert_eq!(root, PathBuf::from("/Users/alice/.nectus/worktrees/nectus"));
    }

    #[test]
    fn expands_bare_tilde_to_home() {
        let root =
            resolve_worktree_root(Path::new("/tmp/nectus"), "~", Some(Path::new("/home/bob")));

        assert_eq!(root, PathBuf::from("/home/bob"));
    }

    #[test]
    fn leaves_non_tilde_patterns_repo_relative() {
        // A pattern without a leading `~` must keep resolving against the repo
        // path exactly as before, even when a home directory is available.
        let root = resolve_worktree_root(
            Path::new("/tmp/nectus"),
            "../{repoName}-worktrees",
            Some(Path::new("/Users/alice")),
        );

        assert_eq!(root, PathBuf::from("/tmp/nectus-worktrees"));
    }

    #[test]
    fn falls_back_to_repo_relative_when_home_missing() {
        // Without a resolvable home, a `~` pattern degrades to the prior
        // repo-relative behavior rather than panicking.
        let root = resolve_worktree_root(Path::new("/tmp/nectus"), "~/work/{repoName}", None);

        assert_eq!(root, PathBuf::from("/tmp/nectus/~/work/nectus"));
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

    fn branch_exists(repo: &Path, branch: &str) -> bool {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["branch", "--list", branch])
            .output()
            .unwrap();
        !String::from_utf8_lossy(&output.stdout).trim().is_empty()
    }

    #[test]
    fn cleanup_task_branch_always_removes_the_branch_even_when_unpushed() {
        let dir = tempdir().unwrap();
        let remote_dir = dir.path().join("remote.git");
        let local_dir = dir.path().join("local");
        Command::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .arg(&remote_dir)
            .output()
            .unwrap();
        init_repo(&local_dir);
        run_git(
            &local_dir,
            &["remote", "add", "origin", &remote_dir.to_string_lossy()],
        );
        fs::write(local_dir.join("a.txt"), "base\n").unwrap();
        run_git(&local_dir, &["add", "a.txt"]);
        run_git(&local_dir, &["commit", "-m", "base"]);
        run_git(&local_dir, &["push", "-u", "origin", "main"]);

        // A task branch carrying a commit that was never pushed.
        fs::write(local_dir.join("b.txt"), "wip\n").unwrap();
        run_git(&local_dir, &["add", "b.txt"]);
        run_git(&local_dir, &["commit", "-m", "unpushed work"]);
        run_git(&local_dir, &["branch", "task-unpushed"]);

        // Deleting a task drops its branch regardless of unpushed commits.
        assert!(!branch_fully_pushed(&local_dir, "task-unpushed"));
        cleanup_task_branch(&local_dir, "task-unpushed");
        assert!(!branch_exists(&local_dir, "task-unpushed"));

        // A missing branch is tolerated (no-op, no panic).
        cleanup_task_branch(&local_dir, "task-never-existed");
    }

    fn commit_repo_with_worktree(dir: &Path, worktree_name: &str) -> PathBuf {
        init_repo(dir);
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        run_git(dir, &["add", "a.txt"]);
        run_git(dir, &["commit", "-m", "base"]);
        let worktree = dir.join(worktree_name);
        run_git(
            dir,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                worktree.to_str().unwrap(),
            ],
        );
        worktree
    }

    #[test]
    fn removes_a_clean_worktree_without_force() {
        let dir = tempdir().unwrap();
        let worktree = commit_repo_with_worktree(dir.path(), "wt-clean");
        assert!(worktree.exists());

        remove_worktree(dir.path(), &worktree, false).unwrap();

        assert!(!worktree.exists());
    }

    #[test]
    fn refuses_to_remove_a_dirty_worktree_without_force() {
        let dir = tempdir().unwrap();
        let worktree = commit_repo_with_worktree(dir.path(), "wt-dirty");
        fs::write(worktree.join("uncommitted.txt"), "wip\n").unwrap();

        let error = remove_worktree(dir.path(), &worktree, false).unwrap_err();

        assert_eq!(error, WORKTREE_HAS_CHANGES);
        assert!(worktree.exists(), "a dirty worktree must be preserved");
    }

    #[test]
    fn force_removes_a_dirty_worktree() {
        let dir = tempdir().unwrap();
        let worktree = commit_repo_with_worktree(dir.path(), "wt-dirty");
        fs::write(worktree.join("uncommitted.txt"), "wip\n").unwrap();

        remove_worktree(dir.path(), &worktree, true).unwrap();

        assert!(!worktree.exists());
    }

    #[test]
    fn deletes_a_local_branch_and_tolerates_missing() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        init_repo(repo);
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        run_git(repo, &["add", "a.txt"]);
        run_git(repo, &["commit", "-m", "base"]);
        run_git(repo, &["branch", "ephemeral"]);

        delete_branch(repo, "ephemeral").unwrap();
        let listed = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["branch", "--list", "ephemeral"])
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&listed.stdout).trim().is_empty());

        // Deleting an already-absent branch is a no-op, not an error.
        delete_branch(repo, "ephemeral").unwrap();
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
        assert_eq!(
            parse_remote_owner_repo("https://github.com/owner-only"),
            None
        );
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
        let by_path: HashMap<&str, &DiffFileEntry> = files
            .iter()
            .map(|file| (file.path.as_str(), file))
            .collect();

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
        let by_path: HashMap<&str, &DiffFileEntry> = files
            .iter()
            .map(|file| (file.path.as_str(), file))
            .collect();

        let modified = by_path.get("a.txt").expect("a.txt in diff");
        assert_eq!(modified.change, DiffChangeKind::Modified);
        // Both the committed and the uncommitted additions, relative to the base.
        assert_eq!(modified.additions, 2);
        assert_eq!(
            by_path.get("b.txt").expect("b.txt in diff").change,
            DiffChangeKind::Added
        );
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
        assert!(
            tracked.contains("-two"),
            "tracked patch shows the removed line"
        );
        assert!(
            tracked.contains("+TWO"),
            "tracked patch shows the added line"
        );

        let untracked = diff_file(repo, None, "new.txt").unwrap();
        assert!(
            untracked.contains("new.txt"),
            "untracked patch names the file"
        );
        assert!(
            untracked.contains("+fresh"),
            "untracked patch shows the new line"
        );
    }
}
