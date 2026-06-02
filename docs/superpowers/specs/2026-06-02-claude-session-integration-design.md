# Claude session integration (notifications + attention parity with Codex)

Date: 2026-06-02
Status: Implemented (backend + tests; live GUI smoke test pending)

## Problem

nectus-desktop launches agent CLIs (`codex`, `claude`, `gemini`) in a PTY. For
**Codex**, a background watcher (`spawn_codex_event_watcher`) tails Codex's JSONL
session log and emits two Tauri events:

- `session_idle` — a turn finished (Codex `task_complete`/`turn_complete`)
- `session_needs_input` — Codex is waiting on an approval / input request

The frontend (`useSessionEvents.ts`) listens to both, shows an in-app message,
updates the per-task attention badge, fires an OS notification
(`tauri-plugin-notification`), and (for idle) the backend auto-triggers pair
review (`spawn_review_on_session_idle`).

**Claude has none of this.** A Claude session runs in the PTY, but no idle /
needs-input events are ever emitted, so notifications, the attention badge, and
auto pair-review silently do nothing for Claude. Resume already works
(`start_session_record` persists `last_session_id`, and `resume_session` accepts
`AgentKind::Claude`).

Goal: bring Claude to parity with Codex — notify when a Claude turn finishes and
when Claude needs input — reusing the existing event/DB/frontend machinery.

## Approach decision

Two candidate signal sources were evaluated:

1. **Tail Claude's transcript** at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`.
   Rejected: the cwd→dirname encoding is undocumented (fragile), and the
   transcript exposes only `stop_reason: end_turn` for completion — there is **no
   clean "needs permission/input" signal**. It would deliver only half the
   feature, fragilely.

2. **Claude Code hooks (chosen).** Claude Code fires a `Stop` hook when a turn
   finishes and a `Notification` hook (matcher matches notification-type strings
   such as `permission_prompt`, `elicitation_dialog`) when it needs the user.
   These map exactly to `session_idle` / `session_needs_input`. Hooks are
   injected at launch via `claude --settings '<inline JSON>'`, which per the
   official CLI reference is "a settings JSON file **or an inline JSON string**"
   whose keys "override the same keys ... Keys you omit keep their file-based
   values" — i.e. it **merges**, so the user's own hooks are not clobbered.

Verified against official docs (code.claude.com/docs): `--settings` inline+merge,
`Stop`/`Notification` hook semantics and stdin shape (`session_id`,
`transcript_path`, `cwd`, `hook_event_name`, plus `message`/`notification_type`
for notifications), `--session-id` sets the UUID, `--resume` reuses it.

### IPC: nectus-owned per-session sink file

Each hook is a tiny POSIX shell command that appends the hook's stdin payload as
**one JSON line** to a nectus-owned sink:

```
$TMPDIR/nectus/claude-hooks/<session-id>.jsonl
```

Command shape (kind is `idle` for Stop, `needs_input` for Notification):

```sh
{ printf '{"kind":"idle","payload":'; tr -d '\n'; printf '}\n'; } >> '<sink>'
```

`tr -d '\n'` only strips structural newlines (JSON strings escape newlines as
`\n`), so the result is a single valid JSON line, atomically appended (payloads
are well under PIPE_BUF; Stop and Notification never fire concurrently for one
session). The sink filename is keyed by the UUID nectus already passes via
`--session-id`, so the path is deterministic — no encoding guesswork, and no
dependency on Claude's transcript layout. `tr`/`printf` are POSIX (macOS/Linux;
Windows is out of scope for now, consistent with the rest of the app).

A `spawn_claude_event_watcher` thread — structurally identical to the Codex
watcher — tails the sink, parses each line, and emits the **same**
`SessionIdleEvent` / `SessionNeedsInputEvent`. The sink is truncated at watcher
start so a resumed session (same UUID, same sink path) never replays stale
events.

## Components

### New: `native/src/sessions/claude.rs`

- `event_sink_path(session_id) -> PathBuf` — `$TMPDIR/nectus/claude-hooks/<id>.jsonl`.
- `hook_settings_json(sink: &Path) -> String` — builds the `--settings` inline
  JSON wiring `Stop` and `Notification` (matcher `permission_prompt|elicitation_dialog`)
  to the append command. Pure; serde handles JSON escaping; the sink path is
  shell-single-quoted with `'` escaped as `'\''`.
- `prepare_event_sink(session_id) -> io::Result<PathBuf>` — `create_dir_all` +
  truncate.
- `cleanup_event_sink(session_id)` — best-effort remove on session end.
- Types: `ClaudeHookLine { kind, payload }`, `ClaudeHookPayload { message,
  notification_type, last_assistant_message }` (all optional, tolerant).
- `ClaudeSessionEvent { Idle { message }, NeedsInput { reason, prompt } }` and
  `claude_session_event_from_line(line) -> Option<ClaudeSessionEvent>`.
- `spawn_claude_event_watcher(app, db, sessions, task_id, session_id, cwd)` —
  truncates the sink, then polls every 500 ms: read sink, skip processed lines,
  emit `session_idle` (+ `spawn_review_on_session_idle`) / `session_needs_input`,
  exit when the session leaves the live `sessions` map.

### Edit: `native/src/sessions/agents/claude.rs`

`configure` appends `--settings <hook_settings_json>` after the existing
`--session-id`/`--resume <id>` args.

### Edit: `native/src/sessions/mod.rs`

- `mod claude;` + imports.
- After the existing Codex branch in `start()`, add an `AgentKind::Claude` branch
  spawning `spawn_claude_event_watcher`.
- Best-effort `claude::cleanup_event_sink` on PTY EOF and in `stop()` for Claude.

### Edit: `native/src/sessions/agents/mod.rs` (tests)

Relax `configures_claude_new_session_id_after_custom_args` to account for the new
`--settings` arg (assert the session-id prefix and that a valid hooks JSON
follows).

## Mapping

| Claude hook | Sink `kind` | Emitted event | Frontend result |
|---|---|---|---|
| `Stop` | `idle` | `session_idle` (message ← `last_assistant_message`) | "Claude finished" notification + attention + pair-review |
| `Notification` (`permission_prompt`/`elicitation_dialog`) | `needs_input` | `session_needs_input` (reason ← `notification_type`, prompt ← `message`) | "Claude needs input" notification + attention |

## Out of scope / unchanged

- Frontend: no changes. `useSessionEvents.ts`, attention, notifications, resume
  gating already handle both events generically (`agentName` resolves to
  "Claude" from the task profile; the `"Codex"` literal is only a null-fallback).
- DB/models: `SessionIdleEvent`/`SessionNeedsInputEvent`, `last_session_id`
  persistence, and seeded Claude profile already exist.
- Windows support for the shell hook command (POSIX-only for now).
- Deriving a resumable label for Claude (Codex-only today); a follow-up.

## Testing

- Unit-test `claude_session_event_from_line` for idle, needs_input (with/without
  message), unknown kind, and malformed JSON (tolerant → `None`).
- Unit-test `hook_settings_json` produces valid JSON with `Stop` + `Notification`
  entries and a sink path that round-trips through shell quoting.
- Update the agents argv test.
- `cargo test` + `cargo clippy` clean.
