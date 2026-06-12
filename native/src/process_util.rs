use std::collections::HashSet;
use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Run a single-binary third-party CLI (`gh`): resolve it against PATH + the
/// common install dirs, run it in `current_dir`, and map a missing binary to
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

/// Capture the user's interactive login-shell environment once per process.
///
/// A macOS app launched from Finder/Dock inherits only a minimal environment: a
/// stripped `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) and none of the variables the
/// user exports in their shell profile/rc — notably provider API keys
/// (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) that node-based agent CLIs read
/// straight from the environment. A terminal launch would have all of these; a
/// GUI launch would not, so spawned agents/reviewers fail with "API key is
/// missing" even though the key is in the user's shell. We run the user's login
/// shell once, dump its `env`, and fold the result into every spawned child so a
/// GUI launch behaves like a terminal launch. Cached because spawning the shell
/// sources rc files and is not free; bounded by a timeout so a slow/hanging rc
/// can't block startup. This is the single source for both the login-shell `PATH`
/// ([`login_shell_path`]) and the seed environment ([`login_shell_environment`]).
fn login_shell_env() -> &'static [(String, String)] {
    static CACHE: OnceLock<Vec<(String, String)>> = OnceLock::new();
    CACHE.get_or_init(|| capture_login_shell_env().unwrap_or_default())
}

/// The user's login-shell environment to seed spawned agents/reviewers with, so a
/// GUI-launched app hands them the same provider keys and config a terminal launch
/// would. `PATH` is omitted because callers set it explicitly via
/// [`augmented_path`]; apply this first, then `PATH`, then any profile env.
pub(crate) fn login_shell_environment() -> Vec<(String, String)> {
    login_shell_env()
        .iter()
        .filter(|(key, _)| key != "PATH")
        .cloned()
        .collect()
}

/// The user's real login-shell `PATH`, pulled out of the captured login-shell
/// environment (see [`login_shell_env`]). Used to fold the user's actual install
/// dirs — Homebrew at any prefix, `mise`/`asdf`/`volta` shims, `~/bin`, … — into
/// both resolution ([`resolve_executable`]) and the child `PATH`
/// ([`augmented_path`]), which `third_party_bin_dirs` alone can't enumerate.
fn login_shell_path() -> Option<OsString> {
    login_shell_env()
        .iter()
        .find(|(key, _)| key == "PATH")
        .filter(|(_, value)| !value.is_empty())
        .map(|(_, value)| OsString::from(value))
}

fn login_shell_dirs() -> Vec<PathBuf> {
    login_shell_path()
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default()
}

fn capture_login_shell_env() -> Option<Vec<(String, String)>> {
    let shell = env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/zsh"));
    // -l (login) sources profile files (e.g. .zprofile, where Homebrew's shellenv
    // usually lands); -i (interactive) sources rc files (e.g. .zshrc, where shim
    // managers like mise/asdf hook in and where users often export API keys). The
    // marker lets us pick the env dump out of any unrelated rc chatter. stdin is
    // closed and stderr discarded so an interactive rc can neither block on input
    // nor pollute the parsed output.
    let mut child = Command::new(&shell)
        .args(["-l", "-i", "-c", "printf '__NECTUS_ENV__\\n'; env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }

    let output = child.wait_with_output().ok()?;
    Some(parse_marked_env(&output.stdout))
}

/// Parse the `env` dump that follows the marker line emitted by the login shell
/// into `(key, value)` pairs. Lines before the marker (rc chatter) are skipped.
/// A line that isn't a `KEY=` assignment is treated as a continuation of the
/// previous value, so multi-line values survive intact.
fn parse_marked_env(stdout: &[u8]) -> Vec<(String, String)> {
    const MARKER: &str = "__NECTUS_ENV__";
    let text = String::from_utf8_lossy(stdout);
    let Some(start) = text.find(MARKER) else {
        return Vec::new();
    };
    let mut vars: Vec<(String, String)> = Vec::new();
    for line in text[start + MARKER.len()..].lines() {
        match split_env_line(line) {
            Some((key, value)) => vars.push((key.to_string(), value.to_string())),
            None => {
                if let Some(last) = vars.last_mut() {
                    last.1.push('\n');
                    last.1.push_str(line);
                }
            }
        }
    }
    vars
}

/// Split a `KEY=VALUE` env line, accepting only a valid shell identifier as the
/// key (`[A-Za-z_][A-Za-z0-9_]*`) so value continuations and stray output don't
/// masquerade as assignments.
fn split_env_line(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once('=')?;
    let mut bytes = key.bytes();
    let first = bytes.next()?;
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return None;
    }
    if !bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_') {
        return None;
    }
    Some((key, value))
}

/// Ordered, de-duplicated search directories: the current process `PATH` first
/// (an explicitly-set entry wins), then the captured login-shell dirs, then the
/// common install dirs as a final backstop.
fn search_dirs(path: &OsStr, home: Option<&Path>, shell_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = env::split_paths(path).collect();
    dirs.extend(shell_dirs.iter().cloned());
    dirs.extend(third_party_bin_dirs(home));
    let mut seen = HashSet::new();
    dirs.retain(|dir| seen.insert(dir.clone()));
    dirs
}

/// Resolve a third-party CLI to an absolute path, searching PATH first, then the
/// user's real login-shell PATH, then the common install locations a
/// GUI-launched macOS app would otherwise miss (see [`login_shell_path`] and
/// [`third_party_bin_dirs`]). Falls back to the bare command name when nothing
/// matches, so callers still get the usual "not found" error when the tool
/// genuinely isn't installed.
pub(crate) fn resolve_executable(command: &str) -> OsString {
    resolve_executable_in(
        command,
        env::var_os("PATH").unwrap_or_default(),
        env::var_os("HOME").map(PathBuf::from).as_deref(),
        &login_shell_dirs(),
    )
}

fn resolve_executable_in(
    command: &str,
    path: OsString,
    home: Option<&Path>,
    shell_dirs: &[PathBuf],
) -> OsString {
    // Reusing `which`'s own executable detection keeps the bit-check logic in one
    // place.
    let dirs = search_dirs(&path, home, shell_dirs);
    let search_path = env::join_paths(dirs).unwrap_or_else(|_| path.clone());
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in(command, Some(&search_path), cwd)
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|_| command.into())
}

/// Build a `PATH` that folds the user's login-shell PATH and the common install
/// dirs (see [`login_shell_path`] and [`third_party_bin_dirs`]) into the current
/// `PATH`. Resolving an agent binary to an absolute path is not enough on a
/// GUI-launched app: node-based CLIs (e.g. Codex) then exec `node` themselves,
/// which must be on the child's `PATH`. Set this as the spawned command's `PATH`
/// so those nested tools resolve too.
pub(crate) fn augmented_path() -> OsString {
    augmented_path_in(
        env::var_os("PATH").unwrap_or_default(),
        env::var_os("HOME").map(PathBuf::from).as_deref(),
        &login_shell_dirs(),
    )
}

fn augmented_path_in(path: OsString, home: Option<&Path>, shell_dirs: &[PathBuf]) -> OsString {
    let dirs = search_dirs(&path, home, shell_dirs);
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
            &[],
        );

        assert_eq!(resolved, executable.into_os_string());
    }

    #[test]
    fn resolves_from_login_shell_dir_outside_the_fixed_list() {
        // Reproduces the home-dir Homebrew (`~/homebrew/bin`) case: the binary is
        // in a dir that is neither on the minimal PATH nor in third_party_bin_dirs,
        // but is present in the user's login-shell PATH.
        let home = tempdir().unwrap();
        let bin_dir = home.path().join("homebrew").join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let executable = bin_dir.join("acli");
        std::fs::write(&executable, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();

        let resolved = resolve_executable_in(
            "acli",
            OsString::from("/usr/bin:/bin:/usr/sbin:/sbin"),
            Some(home.path()),
            std::slice::from_ref(&bin_dir),
        );

        assert_eq!(resolved, executable.into_os_string());
    }

    #[test]
    fn parses_env_dump_after_marker_ignoring_rc_chatter() {
        let stdout = b"some rc banner\n__NECTUS_ENV__\nPATH=/a/bin:/b/bin\nOPENAI_API_KEY=sk-123\n";
        let vars = parse_marked_env(stdout);
        assert_eq!(
            vars,
            vec![
                ("PATH".to_string(), "/a/bin:/b/bin".to_string()),
                ("OPENAI_API_KEY".to_string(), "sk-123".to_string()),
            ]
        );
        // No marker → nothing captured (the shell run failed or printed nothing).
        assert!(parse_marked_env(b"no marker here\n").is_empty());
    }

    #[test]
    fn reassembles_multi_line_env_values() {
        // A value with an embedded newline (e.g. a PEM key) spills onto extra
        // lines that aren't KEY= assignments; they rejoin the preceding value.
        let stdout = b"__NECTUS_ENV__\nKEY=line1\nline2\nNEXT=ok\n";
        let vars = parse_marked_env(stdout);
        assert_eq!(
            vars,
            vec![
                ("KEY".to_string(), "line1\nline2".to_string()),
                ("NEXT".to_string(), "ok".to_string()),
            ]
        );
    }

    #[test]
    fn split_env_line_accepts_only_valid_identifiers() {
        assert_eq!(split_env_line("FOO=bar"), Some(("FOO", "bar")));
        assert_eq!(split_env_line("_x9=v=w"), Some(("_x9", "v=w")));
        assert_eq!(split_env_line("EMPTY="), Some(("EMPTY", "")));
        // Continuations / non-assignments are rejected so they fold into the
        // previous value instead of becoming bogus vars.
        assert_eq!(split_env_line("no key"), None);
        assert_eq!(split_env_line("1BAD=x"), None);
        assert_eq!(split_env_line("HAS-DASH=x"), None);
    }

    #[test]
    fn login_shell_path_is_extracted_from_the_env_dump() {
        let stdout = b"__NECTUS_ENV__\nHOME=/Users/me\nPATH=/p1:/p2\n";
        let vars = parse_marked_env(stdout);
        let path = vars
            .iter()
            .find(|(key, _)| key == "PATH")
            .map(|(_, value)| value.clone());
        assert_eq!(path, Some("/p1:/p2".to_string()));
        // login_shell_environment() omits PATH (callers set it via augmented_path).
        assert!(!vars
            .iter()
            .filter(|(k, _)| k != "PATH")
            .any(|(k, _)| k == "PATH"));
    }

    #[test]
    fn augments_minimal_path_with_install_dirs() {
        let home = tempdir().unwrap();

        let augmented = augmented_path_in(OsString::from("/usr/bin:/bin"), Some(home.path()), &[]);
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
        // A dir present on PATH, in the login-shell dirs, and in the fixed list
        // must still appear exactly once.
        let augmented = augmented_path_in(
            OsString::from("/opt/homebrew/bin:/usr/bin"),
            None,
            &[PathBuf::from("/opt/homebrew/bin")],
        );
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
            &[],
        );

        assert_eq!(resolved, OsString::from("definitely-not-a-real-binary"));
    }
}
