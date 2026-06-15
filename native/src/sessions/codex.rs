//! Codex session-metadata probe for post-exit resume (`resolve_resumable_metadata`).
//! ACP chat is the primary surface; rollout JSONL event watching was removed.

use serde::Deserialize;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub(super) struct CodexSessionMetadata {
    pub id: String,
    pub label: Option<String>,
}

// ---------------------------------------------------------------------------
// Vendored Codex rollout types (session_meta line only)
//
// Mirrors `codex-protocol` session_meta shape; vendored to avoid the full
// Codex runtime dependency tree. See docs/codex-session-jsonl.md.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RolloutLine {
    timestamp: chrono::DateTime<chrono::FixedOffset>,
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SessionMeta {
    id: String,
    cwd: String,
    timestamp: Option<chrono::DateTime<chrono::FixedOffset>>,
    source: Option<serde_json::Value>,
    thread_source: Option<String>,
    model: Option<String>,
    thread_name: Option<String>,
    name: Option<String>,
    title: Option<String>,
    initial_prompt: Option<String>,
}

pub(super) fn latest_codex_session_metadata(
    cwd: &Path,
    started_at: &str,
) -> Option<CodexSessionMetadata> {
    let home = env::var_os("HOME")?;
    let sessions_dir = PathBuf::from(home).join(".codex").join("sessions");
    let started_at = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let cwd = cwd.to_string_lossy();
    let mut best: Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)> = None;
    collect_codex_session_ids(&sessions_dir, &cwd, started_at, &mut best);
    best.map(|(_, metadata)| metadata)
}

fn collect_codex_session_ids(
    dir: &Path,
    cwd: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
    best: &mut Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)>,
) {
    let mtime_cutoff = (started_at - chrono::Duration::seconds(60)).with_timezone(&chrono::Utc);
    for entry in WalkDir::new(dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified| chrono::DateTime::<chrono::Utc>::from(modified) < mtime_cutoff)
        {
            continue;
        }
        let path = entry.into_path();
        if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let mut reader = BufReader::new(file);
        let mut first_line = String::new();
        let Ok(bytes_read) = reader.read_line(&mut first_line) else {
            continue;
        };
        if bytes_read == 0 {
            continue;
        }

        let Some((timestamp, metadata)) =
            codex_session_metadata_from_line(&first_line, cwd, started_at)
        else {
            continue;
        };

        if best
            .as_ref()
            .is_none_or(|(best_timestamp, _)| timestamp > *best_timestamp)
        {
            *best = Some((timestamp, metadata));
        }
    }
}

fn codex_session_metadata_from_line(
    line: &str,
    cwd: &str,
    started_at: chrono::DateTime<chrono::FixedOffset>,
) -> Option<(chrono::DateTime<chrono::FixedOffset>, CodexSessionMetadata)> {
    let line = serde_json::from_str::<RolloutLine>(line).ok()?;
    if line.item_type != "session_meta" {
        return None;
    }

    let payload = serde_json::from_value::<SessionMeta>(line.payload).ok()?;
    if payload.cwd != cwd {
        return None;
    }
    if is_codex_subagent_session(&payload) {
        return None;
    }

    let timestamp = payload.timestamp.unwrap_or(line.timestamp);
    if timestamp < started_at {
        return None;
    }

    Some((
        timestamp,
        CodexSessionMetadata {
            id: payload.id.clone(),
            label: codex_session_label(&payload),
        },
    ))
}

fn is_codex_subagent_session(payload: &SessionMeta) -> bool {
    payload.thread_source.as_deref() == Some("subagent")
        || payload.model.as_deref() == Some("codex-auto-review")
        || payload
            .source
            .as_ref()
            .is_some_and(|source| source.get("subagent").is_some())
}

fn codex_session_label(payload: &SessionMeta) -> Option<String> {
    for label in [
        payload.thread_name.as_deref(),
        payload.name.as_deref(),
        payload.title.as_deref(),
        payload.initial_prompt.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let label = label.trim();
        if !label.is_empty() {
            return Some(label.chars().take(120).collect());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_line_matches_cwd_and_started_at() {
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
        let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"session_meta","payload":{"id":"sess-1","cwd":"/repo/app","title":"Fix tests"}}"#;

        let (timestamp, metadata) =
            codex_session_metadata_from_line(line, "/repo/app", started_at).expect("match");
        assert_eq!(metadata.id, "sess-1");
        assert_eq!(metadata.label.as_deref(), Some("Fix tests"));
        assert!(timestamp >= started_at);
    }

    #[test]
    fn metadata_line_rejects_other_cwd_and_subagents() {
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-05-14T10:00:00Z").unwrap();
        let line = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"session_meta","payload":{"id":"sess-1","cwd":"/repo/other"}}"#;
        assert!(codex_session_metadata_from_line(line, "/repo/app", started_at).is_none());

        let subagent = r#"{"timestamp":"2026-05-14T10:00:05.000Z","type":"session_meta","payload":{"id":"sess-sub","cwd":"/repo/app","thread_source":"subagent"}}"#;
        assert!(codex_session_metadata_from_line(subagent, "/repo/app", started_at).is_none());
    }
}
