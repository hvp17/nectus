//! Source-level guards for the DB layer's lock-hygiene invariants.
//!
//! Every `Database` method runs while the caller holds the **global DB mutex**,
//! so no method in `src/db/` may spawn a subprocess (git/gh/acli/anything): a
//! slow or hung child under the lock stalls every other command and freezes the
//! app. Subprocess work belongs in the command layer (`lib.rs`), which takes the
//! lock briefly for reads/writes and shells out only after releasing it.
//!
//! This test scans the module's source so a regression fails CI with a pointed
//! message instead of resurfacing later as a mystery UI freeze.

#![cfg(test)]

use std::fs;
use std::path::Path;

/// Patterns that mean "this code can start a subprocess or block on one".
/// Pure `git_ops` helpers (e.g. `validate_branch_name`) are fine; the spawning
/// ones all go through `Command`/`run_cli`/`git_output` or these wrappers.
const FORBIDDEN: &[&str] = &[
    "Command::new",
    "process::Command",
    "run_cli(",
    "git_output(",
    "is_dirty(",
    "create_worktree(",
    "remove_worktree(",
    "fetch_default_branch(",
    "prune_worktrees(",
    "cleanup_task_branch(",
    "validate_repo_path(",
];

#[test]
fn db_methods_never_spawn_subprocesses_under_the_lock() {
    let db_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db");
    let mut violations = Vec::new();

    for entry in fs::read_dir(&db_dir).expect("read src/db") {
        let path = entry.expect("dir entry").path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // tests.rs exercises full flows (incl. real worktrees); this file quotes
        // the patterns. Both are test-only code.
        if !name.ends_with(".rs") || name == "tests.rs" || name == "invariants.rs" {
            continue;
        }
        scan_file(name, &fs::read_to_string(&path).expect("read source"), &mut violations);
    }

    assert!(
        violations.is_empty(),
        "subprocess call inside src/db (runs under the global DB lock — move it \
         to the command layer in lib.rs and run it after releasing the lock):\n{}",
        violations.join("\n")
    );
}

/// Line scanner with function-level exemptions:
/// - a `fn` directly preceded by `#[cfg(test)]` (test-only convenience wrappers
///   like `create_task_record`), and
/// - every method of the plan types the command layer executes OFF the lock
///   (`impl CrossRepoPlan` / `impl TaskDeletionPlan` in tasks.rs).
fn scan_file(name: &str, source: &str, violations: &mut Vec<String>) {
    let mut current_impl_exempt = false;
    let mut pending_cfg_test = false;
    let mut current_fn_exempt = false;

    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with("//!") {
            continue;
        }
        if trimmed.starts_with("impl ") {
            current_impl_exempt =
                trimmed.contains("CrossRepoPlan") || trimmed.contains("TaskDeletionPlan");
            continue;
        }
        if trimmed.starts_with("#[cfg(test)]") {
            pending_cfg_test = true;
            continue;
        }
        if trimmed.starts_with("pub fn ") || trimmed.starts_with("fn ") {
            current_fn_exempt = pending_cfg_test || current_impl_exempt;
            pending_cfg_test = false;
            // fall through: the signature line itself can't spawn anything
            continue;
        }
        if current_fn_exempt {
            continue;
        }
        for pattern in FORBIDDEN {
            if trimmed.contains(pattern) {
                violations.push(format!("{name}:{} uses `{pattern}`", index + 1));
            }
        }
    }
}
