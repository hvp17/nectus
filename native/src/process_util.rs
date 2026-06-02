use std::process::Output;

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
