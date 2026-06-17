# ACP-Native Reviews — Design

**Status:** Approved for planning (2026-06-16)
**Owner:** reviewer subsystem (`native/src/sessions/`)

## Summary

Replace the bespoke headless-CLI reviewer with a **headless ACP session driver**, so
the app drives agents exactly one way: the Agent Client Protocol. Every reviewing
surface (the task AI review loop, single external PR reviews, and multi-model
consensus PR reviews) runs its reviewer as a headless one-shot ACP turn instead of
spawning a provider-specific CLI and parsing provider-specific stdout. The verdict
moves from a prose text marker to a validated JSON block with session-based
self-repair. This is a clean-slate rewrite of the reviewer path; the existing
reviewer code and its `ReviewerRunOutput` contract are discarded, and breaking
changes (dropping Custom reviewers, dropping the text marker, ACP-native resume) are
accepted.

The ACP *chat* path (`acp_manager.rs::run_connection`) is **not** modified — the
reviewer gets its own focused driver that reuses low-level ACP helpers.

## Goals

- One agent-driving mechanism (ACP) across chat **and** reviews.
- Delete the drift-prone per-provider stdout decoders (`reviewer_output.rs`) and the
  bespoke argv/wire builder (`reviewer.rs`).
- A robust, validated machine verdict that does not depend on prose-grepping.
- Preserve user-visible review behavior: live streaming to the read-only Review pane,
  the `Clean/Blockers/Feedback` verdict semantics, resume for iterative re-review, and
  parallel consensus.

## Non-Goals

- **No changes to the chat runtime.** `run_connection` and the interactive chat
  behavior are untouched. Extracting a shared "ACP turn core" that both chat and
  reviewer build on is explicitly deferred (see *Future Work*).
- **No MCP server.** A bundled `submit_review` MCP tool-call is rejected as
  over-engineering for a one-field verdict (see *Verdict Contract*); revisit only if
  rich structured findings are needed later.
- **No Custom reviewers.** `AgentKind::Custom` has no ACP descriptor and is removed
  from the reviewer-eligible set.

## Background

Today the app drives agents two ways:

- **Chat** → ACP, via `acp_manager.rs` (`agent-client-protocol` crate,
  capability-negotiated, interactive, persisted, UI-emitting).
- **Reviews** → bespoke headless CLI spawns, via `reviewer.rs` (per-`AgentKind` argv:
  `codex exec --json`, `opencode run --format json`, `claude -p`, `agy -p`, custom
  stdin) plus `reviewer_output.rs` (per-provider stdout decoding: Codex `exec --json`
  event stream, OpenCode `run --format json` event stream, plain passthrough).

The reviewer path's maintenance cost is the per-provider decoding, which silently
breaks when a CLI changes its `--json` event shape (e.g. `opencode_error_message`
already tolerates four shapes). Consolidating onto ACP makes `AgentMessageChunk` the
single stable text contract and removes the bespoke decoders. The industry has
converged here: Cursor rebuilt Bugbot from a bespoke pipeline into agentic
review-as-session; headless ACP clients (acpx, Cline CLI, Kiro, Copilot CLI) are an
established pattern.

## Architecture

### New module: `native/src/sessions/review_runtime.rs`

A single async entry point drives a headless ACP turn and returns a clean result:

```text
run_review(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    reviewer: &AgentProfile,        // must resolve an ACP descriptor (non-Custom)
    cwd: &Path,                     // the review worktree
    prompt: &str,
    resume: Option<&str>,           // prior ACP session id, gated on loadSession cap
    sink: Option<ReviewSink>,       // live text streaming target
) -> Result<ReviewRun, String>
```

```text
struct ReviewRun {
    text: String,                   // human-facing review, JSON verdict block stripped
    verdict: Option<VerdictToken>,  // parsed from the verdict block (None => unclear)
    session_id: Option<String>,     // ACP session id to persist + resume
}
```

The driver returns the parsed `VerdictToken` directly (the JSON parse happens inside
the driver so the self-repair re-prompt can run in the live session). Domain adapters
map the token to `ReviewVerdict` / `PrReviewVerdict` as today.

### Turn lifecycle

1. **Resolve launch.** `acp_provider(reviewer.agent_kind)` → descriptor; build argv via
   the existing `build_acp_argv` helper. Reuse the exact env layering from
   `acp_manager` launch: login-shell env, then `augmented_path()` PATH, then descriptor
   env, then profile env (profile wins). No new launch logic.
2. **Connect.** `AcpAgent::from_args(argv)` transport + `Client.builder()` with the two
   headless handlers below; `connect_with(transport, |cx| async { ... })`.
3. **Initialize.** Send `build_initialize_request()` (same Nectus client info, no
   filesystem/terminal client capabilities). Read `loadSession` from the negotiated
   agent capabilities to decide whether resume is possible.
4. **Session.** `session/load` when `resume` is set **and** `loadSession` is advertised;
   otherwise `session/new`. Capture the resolved ACP session id for the result.
5. **Model (best-effort).** If the profile names a model and the session advertises a
   matching config-option Select, set it via the config-option control (the same
   mechanism chat uses); otherwise ignore the profile model.
6. **Prompt.** One `PromptRequest` with the review prompt as a text content block.
7. **Stream + accumulate.** The notification handler folds `AgentMessageChunk`s into a
   `TurnAccumulator`; each text delta is forwarded to the `sink`. Usage/runtime updates
   are ignored (no persistence). The turn ends at the prompt response's stop reason.
8. **Verdict + self-repair.** Parse the verdict JSON block from the accumulated text
   (see *Verdict Contract*). If absent/invalid, send one follow-up `PromptRequest` in
   the same session asking for the verdict block only, accumulate, and re-parse. If
   still absent, return verdict `None` (callers treat as unclear/inconclusive).
9. **Teardown.** Drop the connection; the agent child is stopped. Return `ReviewRun`.

### Reused building blocks (no copies)

- `acp::acp_provider`, `acp_manager::build_acp_argv`, `build_initialize_request`,
  `AcpAgent` transport, `Client.builder()`.
- `TurnAccumulator` for chunk → text folding.
- `process_util` env/PATH helpers.
- `pr_worktree.rs` for the PR review ephemeral worktree (unchanged).
- The two live-output events and their payloads (`review_output` /
  `ReviewOutputEvent`, `pr_review_output` / `PrReviewOutputEvent`).

If `TurnAccumulator` / `build_acp_argv` / `build_initialize_request` are currently
private to `acp_manager`, narrow `pub(super)` exposure is added — no behavior change to
chat.

## Verdict Contract

The reviewer streams its full prose review, then ends with a fenced JSON block carrying
only the machine verdict:

````text
...prose review...

```json
{"verdict": "blockers"}
```
````

- Allowed `verdict` values map to the existing `VerdictToken`:
  `"clean" → Clean`, `"blockers" → Blockers`, `"feedback" → Feedback`
  (case-insensitive). PR reviews never use `feedback` (mapped to `Inconclusive` by the
  PR adapter, unchanged).
- The block is extracted from the **end** of the message (last fenced ```json block
  wins), validated, and **stripped** from the human-facing text.
- **Self-repair:** a missing or invalid block triggers one follow-up prompt in the same
  ACP session: *"Reply with only a ```json block containing {\"verdict\": \"clean\" |
  \"blockers\" | \"feedback\"}."* Re-parse the follow-up. Still missing → `None`.

### `verdict.rs` changes

`verdict.rs` keeps the `VerdictToken` enum and the domain-neutral role. Its parser
changes from line-marker scanning to JSON-block extraction:

- Remove `VERDICT_MARKER`, `parse_verdict_line`, and the line-scanning `parse_and_strip`.
- Add `parse_verdict_block(raw: &str) -> (Option<VerdictToken>, String)` that finds the
  last fenced ```json block, parses `{"verdict": ...}`, validates the token, and returns
  the text with that block removed and trimmed. Non-JSON fenced blocks and prose are
  preserved.

Domain adapters keep their names and signatures, now calling the JSON parser:

- `review_loop.rs::parse_review_verdict(output) -> (ReviewVerdict, String)`
  (`None`/unknown → `ReviewVerdict::Unknown`, surfaced as `UNCLEAR_REVIEW_ERROR`).
- `pr_verdict.rs::parse_pr_review_output(raw) -> (PrReviewVerdict, String)`
  (`Clean → Passed`, `Blockers → Blockers`, else `Inconclusive`).

Because the driver already parses the token, the adapters may take the token directly;
keeping the string-parsing signatures is acceptable if simpler for the callers — the
plan decides. Either way the verdict source is the JSON block, never prose.

### Prompt changes

`build_pr_review_prompt`, the consensus prompts, and the task-review-loop prompt are
rewritten to instruct the JSON verdict block (and "review only — do not modify files")
instead of interpolating `VERDICT_MARKER`. The synthesizer prompt likewise emits a
verdict block.

## Permissions

The headless `on_receive_request` handler **auto-approves** every
`session/request_permission`:

- Select an allow option, preferring `AllowAlways` then `AllowOnce`
  (`RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id))`),
  reusing the existing `permission_option_id_for_kinds` helper.
- Emit nothing to the UI and persist nothing (headless, no transcript).
- On teardown/cancel, answer any pending request with
  `RequestPermissionOutcome::Cancelled` (ACP spec requirement).
- Tolerate agents that never request permission (some auto-approve internally in ACP
  mode).

The review prompt states "review only — do not modify files." A hard read-allow /
write-reject policy is intentionally **not** implemented: PR reviews run in a throwaway
worktree, and the task-review-loop write risk is low. This matches how headless ACP
clients run.

## Live Output Streaming

`ReviewSink` mirrors today's two-channel behavior so the read-only `ReviewTerminalPane`
is unchanged:

- Task review loop → `review_output` event, keyed by `task_id`, with a running
  `start_offset`.
- Single PR review → `pr_review_output` event, keyed by `review_id`.
- Consensus member runs and the synthesizer run stream no live output (unchanged from
  today — consensus members pass `None`).

The sink receives each `AgentMessageChunk` text delta from the notification handler.

## Resume

- Reviewer resume becomes ACP-native: `session/load` with the stored ACP session id,
  **gated on the agent advertising `loadSession`** in the initialize response — not a
  hardcoded per-`AgentKind` table.
- `reviewer_supports_resume(AgentKind)` is removed; callers persist
  `ReviewRun.session_id` and pass it back as `resume` on the next run. The driver
  decides at runtime whether load is possible.
- `review_loop.rs` keeps "persist the resolved id only on the first run"; `pr_review.rs`
  likewise. The DB columns (`review_loop` session id, `pr_review` session id) are
  reused as-is — they now hold ACP session ids.

## Consensus

`pr_consensus.rs` replaces its `std::thread` fan-out with async concurrency:

- Run the N member reviews concurrently with `futures::future::join_all` (or
  `tokio::join!`/`JoinSet`), each calling `run_review` with `sink: None`.
- Collect `Vec<Result<ReviewRun, String>>`, preserving input order for stable
  attribution.
- The synthesizer is one more `run_review` await (no sink), emitting its own verdict
  block.

## Caller Integration

The three callers keep their feature behavior; only the reviewer invocation changes.

- **`review_loop.rs`** — await `run_review` instead of `run_reviewer_command`; use
  `ReviewRun.text` / `.session_id` / `.verdict`. Persist session id on first run; map
  verdict via `parse_review_verdict` (or the token directly).
- **`pr_review.rs`** — same, with the `pr_review_output` sink; persist session id;
  `parse_pr_review_output`; `set_pr_review_result`.
- **`pr_consensus.rs`** — async fan-out as above; `parse_pr_review_output` per member;
  synthesizer await.

Whatever command handlers invoke these become `async` (or `await` within their existing
async context). The blocking-child model and its `std::thread` parallelism are gone.

## Breaking Changes (accepted)

1. **Custom reviewers removed.** `AgentKind::Custom` is rejected for review with a clear
   error ("Custom agents cannot run ACP reviews; choose an ACP provider").
2. **Verdict marker removed.** `NECTUS_VERDICT:` prose marker → validated JSON block.
3. **Resume reset.** Stored pre-upgrade reviewer session ids (Claude UUID / Codex thread
   / OpenCode session) won't `session/load` against an ACP session; the first
   post-upgrade review per task/PR starts fresh. No migration; document it.
4. **Profile flags.** Literal `--model` / `--full-auto` / `--agent build` no longer pass
   through; model maps to the ACP config-option, autonomy maps to auto-approve.

## Deletions

- `native/src/sessions/reviewer_output.rs` (entire module + tests).
- `native/src/sessions/reviewer.rs` argv/wire/spawn path: `run_reviewer_command`,
  `build_reviewer_args`, `ReviewerCommandPlan`, `ReviewerWire`, `ReviewerRunOutput`,
  `ReviewOutputSink`/`ReviewOutputTarget` (replaced by `ReviewSink` in the new module),
  `reviewer_supports_resume`, `new_reviewer_session_id`, and their tests. If nothing
  reviewer-specific remains, delete `reviewer.rs`; otherwise keep only shared bits.
- `verdict.rs` line-marker parser (replaced by the JSON-block parser).

## Error Handling

- Launch/initialize/session failures → `Err(String)` surfaced through the existing
  review-run error paths (review loop records `error`; PR review marks the run failed).
- Agent prompt errors / non-`end_turn` stop reasons with no text → error string.
- Missing verdict after self-repair → verdict `None` → `Unknown`/`Inconclusive` (no hard
  failure; the human text is still kept).
- Auto-approve handler never blocks; teardown cancels pending permission requests.

## Testing

A mock ACP agent transport drives the headless turn deterministically:

- **Auto-approve handler:** approves across option-kind shapes (AllowAlways present /
  only AllowOnce present); cancels pending on teardown.
- **Accumulation:** `AgentMessageChunk` deltas fold into the final text and stream to a
  captured sink in order with correct offsets.
- **Verdict block:** extraction of the trailing ```json block, case-insensitive token
  validation, stripping from human text, last-block-wins, and rejection of malformed /
  non-JSON blocks.
- **Self-repair:** missing block triggers exactly one follow-up prompt; a valid
  follow-up resolves the verdict; a second miss yields `None`.
- **Resume gating:** `session/load` only when `loadSession` is advertised, else
  `session/new`.
- **Domain adapters:** `parse_review_verdict` / `parse_pr_review_output` token mapping
  (kept from current tests, retargeted to JSON input).
- **Consensus:** N concurrent runs preserve order; one member failing does not abort the
  others; synthesizer runs after members.

`reviewer_output.rs` tests are deleted with the module. `verdict.rs` tests are rewritten
for JSON input. Existing `build_pr_review_prompt` / consensus prompt tests update to the
JSON-block instruction.

## Risks

- **Antigravity `agy-acp` is preview-maturity** — ACP reviews via it may be flakier than
  the old `agy -p`. Same adapter chat already uses; acceptable, monitored.
- **Model config-option coverage** — an agent that exposes no model Select means the
  profile's model is silently best-effort. Documented behavior.
- **Resume reset churn** — first post-upgrade review starts fresh (see Breaking Changes).
- **Permission variance** — agents differ in whether/what they request; the handler
  must approve all shapes and tolerate silence. Covered by tests.

## Documentation Updates (same change)

- `CLAUDE.md` backend map: replace the `reviewer.rs` / `reviewer_output.rs` descriptions
  with the new `review_runtime.rs`; update the "Spawning External CLIs" reviewer call
  site; note ACP is now the single agent-driving path.
- `docs/architecture.md`: the "where does X live" table + the "why one agent-driving
  path" note (the boundary previously split chat vs reviewer is gone).
- `docs/features.md`: reviewer behavior now ACP-backed; verdict via JSON block; Custom
  agents cannot review.
- `docs/tracking-and-debugging.md`: the reviewer events are unchanged, but the runtime
  notes move from CLI-spawn to ACP session.
- `docs/github-integration.md`: PR-review runtime note (ACP-backed).

## Future Work (out of scope)

- **Shared ACP-turn core.** Extract a reusable turn engine parameterized by observer +
  permission-resolver + persistence-policy, and reduce both chat and reviewer to thin
  configs over it. Deferred to protect the chat path until the headless driver is proven.
- **MCP `submit_review` tool-call.** If reviews need rich structured findings
  (per-file/line, severity), add a bundled MCP server (subcommand of the app binary,
  injected via `mcpServers`, arguments captured from the `session/update` ToolCall
  stream). Not warranted for a one-field verdict.
</content>
</invoke>
