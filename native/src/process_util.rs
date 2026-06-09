use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Run a single-binary third-party CLI (`gh`, `acli`): resolve it against PATH +
/// the common install dirs, run it in `current_dir`, and map a missing binary to
/// `not_installed_message`. No `augmented_path` — these spawn no nested `node`.
pub(crate) fn run_cli(
    command: &str,
    current_dir: Option<&Path>,
    not_installed_message: &str,
    args: &[&str],
) -> Result<Output, String> {
    let mut cmd = Command::new(resolve_executable(command));
    if let Some(dir) = current_dir {
        cmd.current_dir(dir);
    }
    cmd.args(args).output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            not_installed_message.to_string()
        } else {
            format!("Failed to run {command}: {error}")
        }
    })
}

/// Build an error message from a failed command's stderr, falling back to a
/// fixed message when stderr is empty.
pub(crate) fn command_error(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.into()
    } else {
        stderr
    }
}

/// Directories where third-party CLIs are commonly installed, in priority order.
/// A macOS app launched from Finder/Dock inherits only a minimal PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), so these are searched explicitly when a
/// command isn't found on PATH. Single source of truth for both agent command
/// resolution and `gh` detection.
pub(crate) fn third_party_bin_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".npm-global").join("bin"));
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/local/sbin",
        "/opt/homebrew/sbin",
    ] {
        dirs.push(PathBuf::from(dir));
    }
    dirs
}

/// Resolve a third-party CLI to an absolute path, searching PATH first and then
/// the common install locations a GUI-launched macOS app would otherwise miss
/// (see [`third_party_bin_dirs`]). Falls back to the bare command name when
/// nothing matches, so callers still get the usual "not found" error when the
/// tool genuinely isn't installed.
pub(crate) fn resolve_executable(command: &str) -> OsString {
    resolve_executable_in(
        command,
        env::var_os("PATH").unwrap_or_default(),
        env::var_os("HOME").map(PathBuf::from).as_deref(),
    )
}

fn resolve_executable_in(command: &str, path: OsString, home: Option<&Path>) -> OsString {
    // Search PATH first, then append the common install dirs. Reusing `which`'s
    // own executable detection keeps the bit-check logic in one place.
    let mut dirs: Vec<PathBuf> = env::split_paths(&path).collect();
    dirs.extend(third_party_bin_dirs(home));
    let search_path = env::join_paths(dirs).unwrap_or_else(|_| path.clone());
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in(command, Some(&search_path), cwd)
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|_| command.into())
}

/// Build a `PATH` that appends the common install dirs (see
/// [`third_party_bin_dirs`]) to the current `PATH`. Resolving an agent binary
/// to an absolute path is not enough on a GUI-launched app: node-based CLIs
/// (e.g. Codex) then exec `node` themselves, which must be on the child's `PATH`.
/// Set this as the spawned command's `PATH` so those nested tools resolve too.
pub(crate) fn augmented_path() -> OsString {
    augmented_path_in(
        env::var_os("PATH").unwrap_or_default(),
        env::var_os("HOME").map(PathBuf::from).as_deref(),
    )
}

fn augmented_path_in(path: OsString, home: Option<&Path>) -> OsString {
    let mut dirs: Vec<PathBuf> = env::split_paths(&path).collect();
    for dir in third_party_bin_dirs(home) {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    env::join_paths(dirs).unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    #[test]
    fn resolves_gh_from_homebrew_dir_when_gui_path_is_minimal() {
        // Reproduces the built-app bug: launched from Finder, the app gets only a
        // minimal PATH that excludes Homebrew, where `gh` is installed.
        let home = tempdir().unwrap();
        let bin_dir = home.path().join(".local").join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let executable = bin_dir.join("gh");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let resolved = resolve_executable_in(
            "gh",
            OsString::from("/usr/bin:/bin:/usr/sbin:/sbin"),
            Some(home.path()),
        );

        assert_eq!(resolved, executable.into_os_string());
    }

    #[test]
    fn augments_minimal_path_with_install_dirs() {
        let home = tempdir().unwrap();

        let augmented = augmented_path_in(OsString::from("/usr/bin:/bin"), Some(home.path()));
        let dirs: Vec<PathBuf> = env::split_paths(&augmented).collect();

        // Original entries are preserved, ahead of the appended install dirs.
        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&home.path().join(".local").join("bin")));
        let usr_bin = dirs
            .iter()
            .position(|d| d == Path::new("/usr/bin"))
            .unwrap();
        let brew = dirs
            .iter()
            .position(|d| d == Path::new("/opt/homebrew/bin"))
            .unwrap();
        assert!(usr_bin < brew, "existing PATH entries should come first");
    }

    #[test]
    fn does_not_duplicate_install_dirs_already_on_path() {
        let augmented = augmented_path_in(OsString::from("/opt/homebrew/bin:/usr/bin"), None);
        let count = env::split_paths(&augmented)
            .filter(|dir| dir == Path::new("/opt/homebrew/bin"))
            .count();

        assert_eq!(count, 1);
    }

    #[test]
    fn falls_back_to_bare_command_when_not_found() {
        // When the tool genuinely isn't installed, return the bare name so the
        // spawn attempt produces the usual NotFound error.
        let resolved = resolve_executable_in(
            "definitely-not-a-real-binary",
            OsString::from("/usr/bin:/bin:/usr/sbin:/sbin"),
            None,
        );

        assert_eq!(resolved, OsString::from("definitely-not-a-real-binary"));
    }
}
