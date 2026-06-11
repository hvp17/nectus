//! In-app diagnostics log: a `tracing` layer that mirrors the same lines the app
//! writes to the console into a bounded in-memory ring buffer and streams each new
//! line to the frontend as a `diagnostic_log` event.
//!
//! The buffer lives behind its *own* `Mutex`, deliberately independent of the
//! global `Database` lock. That is the whole point: when a command hangs while
//! holding the DB lock (e.g. a slow `git fetch` during worktree creation), every
//! DB-backed command blocks, but the diagnostics buffer — and the live event
//! stream — keep working, so the panel can still show where the app got stuck.

use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tracing_subscriber::fmt::MakeWriter;

/// Event name the backend emits for each captured log line.
pub const DIAGNOSTIC_LOG_EVENT: &str = "diagnostic_log";

/// Cap on retained lines. Old lines are dropped first; this bounds memory while
/// keeping enough history to backfill a freshly opened panel.
const MAX_LINES: usize = 4000;

struct DiagnosticsState {
    lines: VecDeque<String>,
    app: Option<AppHandle>,
}

fn state() -> &'static Mutex<DiagnosticsState> {
    static STATE: OnceLock<Mutex<DiagnosticsState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(DiagnosticsState {
            lines: VecDeque::with_capacity(MAX_LINES.min(512)),
            app: None,
        })
    })
}

/// Attach the Tauri app handle so newly captured lines also stream to the UI.
/// Called once during `setup`; lines captured before this only land in the buffer
/// and are backfilled when the panel first reads [`buffered_logs`].
pub fn attach_app_handle(app: AppHandle) {
    if let Ok(mut guard) = state().lock() {
        guard.app = Some(app);
    }
}

/// Snapshot of the retained log lines, oldest first. Never touches the DB lock.
pub fn buffered_logs() -> Vec<String> {
    state()
        .lock()
        .map(|guard| guard.lines.iter().cloned().collect())
        .unwrap_or_default()
}

fn push_line(line: String) {
    // Append under the lock, capture the handle, then release before emitting so
    // the (potentially slower) IPC emit never holds the buffer lock.
    let app = {
        let mut guard = match state().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard.lines.len() >= MAX_LINES {
            guard.lines.pop_front();
        }
        guard.lines.push_back(line.clone());
        guard.app.clone()
    };
    if let Some(app) = app {
        let _ = app.emit(DIAGNOSTIC_LOG_EVENT, line);
    }
}

/// `MakeWriter` that routes a `tracing` fmt layer's formatted output into the
/// in-memory buffer. The fmt layer makes a fresh writer per event and writes one
/// newline-terminated record into it, so flushing on drop yields one line per log.
#[derive(Clone, Default)]
pub struct DiagnosticsWriter;

impl<'a> MakeWriter<'a> for DiagnosticsWriter {
    type Writer = LineWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LineWriter::default()
    }
}

#[derive(Default)]
pub struct LineWriter {
    buf: Vec<u8>,
}

impl Write for LineWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&self.buf).into_owned();
        self.buf.clear();
        for line in text.split('\n') {
            let line = line.trim_end_matches('\r');
            if !line.is_empty() {
                push_line(line.to_string());
            }
        }
        Ok(())
    }
}

impl Drop for LineWriter {
    fn drop(&mut self) {
        let _ = self.flush();
    }
}
