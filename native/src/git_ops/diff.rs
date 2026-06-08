//! Task-diff computation: the file-change summary and per-file unified patches
//! shown in the task workspace's Diff view. A cohesive sub-domain (consumed by
//! the `task_diff_*` command surface) split out from the worktree/validation
//! helpers in the parent module.

use super::{default_remote, git_output, git_output_allowing_codes};
use crate::models::{DiffChangeKind, DiffFileEntry};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

/// The base a worktree task is diffed against: a display label (e.g. `origin/main`)
/// and the merge-base commit the diff is computed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffBase {
    pub label: String,
    pub commit: String,
}

/// Resolve the base to diff a worktree branch against, using only local refs (no
/// network): the merge-base of `HEAD` and the default remote's default branch
/// (`<remote>/HEAD`). The remote is derived (preferring `origin`) rather than
/// hardcoded, so fork/upstream or custom-named remotes resolve too. Returns
/// `None` when no base can be determined — e.g. no remote, or `<remote>/HEAD`
/// unset (no `git remote set-head`) — and callers then diff against `HEAD`.
pub fn resolve_diff_base(path: &Path) -> Option<DiffBase> {
    let remote = default_remote(path).ok()?;
    let symbolic = format!("{remote}/HEAD");
    let default = git_output(
        path,
        &["rev-parse", "--abbrev-ref", &symbolic],
        "Failed to resolve default branch",
    )
    .ok()?;
    let label = String::from_utf8_lossy(&default.stdout).trim().to_string();
    if label.is_empty() || label == symbolic {
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
    if is_untracked(path, file)? {
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
    let Ok(mut file) = std::fs::File::open(path) else {
        return (0, false);
    };
    let mut buffer = [0_u8; 8192];
    let mut newlines = 0_u32;
    let mut saw_any = false;
    let mut last = None;
    loop {
        let Ok(count) = file.read(&mut buffer) else {
            return (0, false);
        };
        if count == 0 {
            break;
        }
        saw_any = true;
        let bytes = &buffer[..count];
        if bytes.contains(&0) {
            return (0, true);
        }
        newlines =
            newlines.saturating_add(bytes.iter().filter(|&&byte| byte == b'\n').count() as u32);
        last = bytes.last().copied();
    }
    let trailing = u32::from(saw_any && last != Some(b'\n'));
    (newlines.saturating_add(trailing), false)
}

/// Whether `file` is untracked (and not ignored) in the repo at `path`. Returns
/// an error instead of silently reporting `false` so [`diff_file`] surfaces a git
/// failure rather than routing the file down the tracked path and showing an
/// empty patch.
fn is_untracked(path: &Path, file: &str) -> Result<bool, String> {
    let output = git_output(
        path,
        &["ls-files", "--others", "--exclude-standard", "--", file],
        "Failed to check whether file is tracked",
    )?;
    Ok(!output.stdout.is_empty())
}

fn untracked_patch(path: &Path, file: &str) -> Result<String, String> {
    // `git diff --no-index` exits 1 when the inputs differ, which is always the
    // case here (one side is /dev/null). Treat exit code 1 as success.
    let output = git_output_allowing_codes(
        path,
        &["diff", "--no-index", "--", "/dev/null", file],
        &[1],
        "git diff --no-index failed",
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
