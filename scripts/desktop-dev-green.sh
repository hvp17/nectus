#!/usr/bin/env bash
# Run the desktop app in dev with a "rebuild only on a clean compile" gate.
#
# Tauri's own watcher kills the running app on every save, then builds — so a
# broken mid-edit terminates the app (and any live Claude/Codex sessions). Here,
# native/.taurignore hides src/ from Tauri, and cargo-watch runs `cargo check`
# on each source change; only when it passes does it touch build.rs, which is
# the signal that makes Tauri rebuild + relaunch. While the code is red the app
# keeps running.
#
# Inherent limit: a *successful* Rust change still relaunches the app (native
# code can't hot-swap), so PTY sessions reset at that moment. Frontend (React/TS)
# changes still hot-reload live via Vite with no restart.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v cargo-watch >/dev/null 2>&1; then
  echo "error: cargo-watch is not installed."
  echo "       install it once with:  cargo install cargo-watch"
  exit 1
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Gate: watch the Rust source, type-check on change, and only ping the app
# (touch build.rs) when it compiles. --postpone skips the redundant check at
# startup so we don't trigger an extra rebuild right after launch.
(
  cd native
  cargo watch --postpone -w src -x check -s 'touch build.rs'
) &

# App: Tauri ignores raw src/ edits (.taurignore) and only rebuilds when the
# gate touches build.rs above.
pnpm tauri dev --config native/tauri.conf.json

wait
