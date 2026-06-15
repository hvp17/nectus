# Multi-CLI Embedded Agent Chat (ACP) — Rolling Plan

> **Status:** In progress on `feat/acp-multi-cli-chat`: Phase 0/1 vertical slice
> is implemented in the real Tauri app; capability-gated `session/load` resume
> has begun; Phase 2 provider-descriptor extraction has started for ACP launch
> metadata, profile-env layering, frontend-readable capability metadata, and
> unsupported-provider chat gating, plus the Chat-tab ACP profile selector and
> file-chip-to-diff selection bridge.
> **Date:** 2026-06-15
> **Decision:** Embed multiple existing agent CLIs (Codex, Claude Code, OpenCode, Gemini, …) behind one chat surface via **ACP (Agent Client Protocol)**.
> **Scope note:** This is a design/intent doc plus rolling implementation notes.
> Check `docs/features.md` and `docs/tracking-and-debugging.md` for current
> shipped behavior.

---

## Context & Decision

The goal is a Cursor-style **embedded coding-agent chat**: one chat surface that renders an agent's work as structured events — streamed prose, reasoning, tool-call cards, file chips that open a diff, native permission prompts, checkpoints, and session resume — rather than rendering a raw terminal TUI.

The product constraint is **embed, multi-CLI**: drive the user's existing agent CLIs (Codex, Claude Code, OpenCode, Gemini, and others), not build an own-harness or a single-vendor integration.

That constraint selects **ACP** as the agent brain:

- **ACP** is the multi-vendor embed standard (Zed + JetBrains). Its agent coverage *is* the target roster: Claude Code, Codex, Gemini, OpenCode, Copilot, Qwen.
- **Managed Agents** (Anthropic) is Claude-only — rejected for a multi-CLI product.
- **Vercel AI SDK `HarnessAgent`** currently wraps only claudeCode/codex/pi and requires a Node runtime/sidecar — rejected.
- Wiring each CLI's own SDK/server (Codex app-server, OpenCode server API, Claude Agent SDK) means N bespoke integrations — rejected in favor of one protocol + one normalization layer.

ACP is JSON-RPC over stdio: spawn each CLI in ACP mode as a subprocess, implement the **client** side once, and consume a uniform typed event stream (agent message chunks, agent thought chunks, tool calls with status/locations/diff content, plan entries, permission requests, available commands; image content blocks in prompts; session resume via `session/load`). It has an official Rust crate (`agent-client-protocol`) plus `agent-client-protocol-tokio`, and community adapters exist for agents lacking native ACP mode.

## Chosen stack

| Layer | Pick | Why |
|---|---|---|
| **Shell** | Tauri 2 (Rust core) + React/TS | ACP's most mature client lib is the Rust crate (Zed's reference impl is Rust). Rust speaks ACP natively over stdio — no Node sidecar, lightweight native app. |
| **Embed layer** | ACP via `agent-client-protocol` + `agent-client-protocol-tokio` | One JSON-RPC-over-stdio protocol for every agent. Spawn each CLI in ACP mode; implement the client side once. |
| **Provider registry** | A capability descriptor per agent (launch cmd, resume?, permission modes, image input?) | The multi-agent core abstraction. Adding an agent = one entry, not a new decoder. |
| **Normalization** | ACP `session/update` → one typed part model (text / reasoning / tool / file_edit / permission / plan) in Rust | The whole point: one schema replaces N per-CLI decoders. |
| **Transport** | Normalized parts → Tauri events; permission requests → a command answering `session/request_permission` | Approvals become native UI, not TUI y/n. |
| **Chat UI** | React + shadcn/ui + AI Elements (registry/reference) + Streamdown | Render the parts; Streamdown handles half-streamed markdown/code fences. |
| **Diff/edit** | Monaco or CodeMirror 6, fed by tool-call `locations` + diff content | The diff pane and file chips. |
| **Workspace** | Local git worktrees + per-turn shadow commits | Agents run in the user's worktree with login-shell env/keys; shadow commits = checkpoint/restore as a `git reset`. |
| **Persistence** | SQLite — normalized parts JSON per turn + ACP session IDs | Transcript replay + resume metadata for free. |

**The heart of "Codex, Claude Code, OpenCode, etc."** is the **provider registry** — each agent is one descriptor:

```
{ id, displayName, acpLaunch: [cmd, args], supportsResume, permissionModel, acceptsImages, … }
```

ACP gives a uniform event stream regardless of which agent produced it, so the registry drives a single transport + renderer. Adding an agent = add a descriptor and confirm its ACP dialect maps onto the part model. No bespoke parser, hook bridge, or log scraper per agent.

---

## Rolling Plan

**How to read this.** Rolling-wave, not a Gantt chart. Phases 0–2 are detailed because they're near and visible; Phases 3–6 are coarser on purpose and get refined at each **re-plan gate**, because what's learned in the spike and the second-agent integration will reshape them. Every phase ends in something demoable and, after Phase 1, shippable behind a flag. Sequence matters more than dates — dates are omitted deliberately; size each phase after Phase 0.

**North star.** One chat surface that drives Codex, Claude Code, OpenCode, and Gemini interchangeably through ACP: streamed prose + reasoning, tool-call cards, file chips that open a diff, native permission prompts, checkpoints, and session resume — adding a new agent is one registry entry, not a new decoder.

**Guiding principles (the plan's invariants).**

1. **The normalized part model is the contract.** Everything upstream (ACP dialects) and downstream (renderers) is replaceable; the part schema is not. Version it from day one.
2. **One agent end-to-end before fan-out.** Prove the whole pipe with Claude Code before generalizing.
3. **Capability-gate, never assume parity.** Agents differ in what they emit and support; the UI degrades gracefully.
4. **Additive.** The PTY terminal stays as a fallback tab throughout — no migration cliff.
5. **Ship each phase behind a flag.** No long-lived branch.

### Phase 0 — Spike & de-risk *(the most important phase)*

- **Goal:** answer the questions that, if wrong, invalidate the whole plan — before building anything durable.
- **Work:** spawn **one agent (Claude Code) in ACP mode** from a Rust throwaway using `agent-client-protocol` + `-tokio`. Drive one prompt, dump every `session/update` to stdout. Hand-render the raw events in a scratch UI. Manually exercise a `session/request_permission` round-trip and a `session/load` resume.
- **Exit criteria:** you can see text, reasoning, a tool call (with status + locations), and a permission request flow through; you've answered: *Does ACP give us the events the chat UI needs? What does resume actually require? How does the worktree/env get passed?*
- **Re-plan trigger:** **part model v1 is frozen here.** If ACP's event shape differs from what was assumed (tool-status granularity, how diffs arrive), the part model and Phase 4's UI change now, cheaply.
- **Defer:** everything else.

### Phase 1 — Vertical slice: one agent, real UI

- **Goal:** a genuinely usable single-agent chat in the real app, flag-gated.
- **Work:** ACP client as a proper Rust session type (sibling to PTY sessions, not a replacement). ACP `session/update` → normalized parts → one new Tauri event channel. Frontend: a `ChatPane` mounted as a new stage tab (`Chat | Terminal | Diff | …`), rendering MessageRow / ToolCard / ReasoningBlock on shadcn + Streamdown. Parts persisted to SQLite (JSON per turn) → transcript replay. Throttled streaming (rAF flush).
- **Exit / demo:** open a task, pick Claude Code, chat, watch tool cards stream, reload and see the transcript replay.
- **Re-plan trigger:** real streaming perf and the persistence shape are now known — adjust the wire format (deltas vs snapshots) if needed.
- **Defer:** other agents, diff integration, checkpoints, approvals UI polish.

### Phase 2 — The contract layer: provider registry + a second agent

- **Goal:** prove the abstraction by generalizing the hardcoded single-agent path into a **provider registry**, then adding a **second agent** (Gemini or Codex).
- **Work:** extract the agent descriptor (`{ id, displayName, acpLaunch, supportsResume, permissionModel, acceptsImages, … }`). Drive launch/transport/resume off the descriptor. Add the second agent as one descriptor + confirm its ACP dialect maps onto the part model. Capability-gate the resume button.
- **Exit / demo:** switch between two agents in the same chat renderer; both stream tool cards.
- **Re-plan trigger (the big one):** **this is where you learn if the part model survives a second dialect.** If it doesn't, the schema gets a v2 and Phases 3–4 reshape. Budget slack here.
- **Defer:** the long tail of agents; rich UX.

### Phase 3 — Multi-agent fan-out

- **Goal:** the rest of the roster — OpenCode, Codex (if not the Phase 2 pick), Copilot/Qwen as desired.
- **Work:** one descriptor per agent. For agents lacking native ACP mode, wire a community adapter (e.g. the Go `acp-adapter`) or a thin shim. Harden graceful degradation: agents emitting only text + tool calls render fine; richer ones (plan entries, granular status) light up extra UI.
- **Exit / demo:** the full picker; each agent works or is explicitly marked "preview/limited."
- **Re-plan trigger:** per-agent maturity reality (the top risk) is now fully known — re-scope Phases 4/6 accordingly.

### Phase 4 — Cursor-grade UX layer

- **Goal:** make it *feel* like the target experience.
- **Work:** native **permission cards** (`session/request_permission` → AlertDialog + persisted allow-once/always policy in SQLite); **file chips → Monaco/CodeMirror diff** pane (fed by tool-call locations + diff content); **checkpoints** (per-turn git shadow commits → restore = `git reset`); composer with **agent picker** + **queued follow-ups** into the live session; **context/usage %** from session usage; **image input** for agents that accept it.
- **Exit / demo:** approve a tool inline, click a file chip into a diff, restore a checkpoint, queue a follow-up mid-run.

### Phase 5 — Session lifecycle & resume hardening

- **Goal:** sessions survive restarts and scale to many concurrent tasks.
- **Work:** `session/load` resume per agent (capability-gated), crash recovery, multi-session management, stale-session cleanup, the left-rail live state sourced from the latest text part.
- **Exit / demo:** kill and relaunch the app mid-run; resume cleanly where supported, degrade clearly where not.

### Phase 6 — Polish, parity, decommission

- **Goal:** production readiness and removing what ACP replaced.
- **Work:** keep terminal as a fallback tab; settings (per-agent config, permission policies); perf pass (virtualized transcript if needed); a11y; telemetry on per-agent event coverage. **Decision:** deprecate the old per-provider JSONL/hook/event watchers once ACP covers their agents — the payoff (N decoders → 1) lands here.
- **Exit:** flag default-on; old decoders retired or scoped to non-ACP agents only.

---

## Cross-cutting workstreams (run through all phases)

- **Part model (versioned).** The contract. Every schema change is a version bump with a migration note.
- **Provider registry.** The multi-agent core; grows one entry per agent.
- **Test strategy.** Fixture-based ACP event → part decoding tests per agent dialect; these are the regression net as CLIs drift.
- **Streaming perf.** rAF-batched store flushes + Streamdown; revisit only if transcripts get long.

## Risk register

| Risk | Likelihood | Mitigation | If it breaks, the plan… |
|---|---|---|---|
| **Per-agent ACP maturity uneven** (Codex/OpenCode) | High | Spike each before committing; community adapters as fallback | …marks weak agents "preview," reorders Phase 3 |
| Resume (`session/load`) not universal | Med | Capability-gate the resume button | …ships resume per-agent, not globally |
| Event richness varies | High | Graceful degradation baked into renderers | …caps UI to the common subset, lights up extras opportunistically |
| Part model wrong after 2nd agent | Med | Phase 2 exists specifically to surface this early | …v2 schema; Phases 3–4 absorb it (cheap now, not later) |
| Streaming re-render storms | Low | Throttled flush from Phase 1 | …add virtualization in Phase 6 |
| Scope creep (cloud, BYOK, indexing) | Med | Parking lot below | …stays parked |

## Re-planning cadence

Re-plan at **every phase gate**, but two are load-bearing: **after Phase 0** (part model frozen, protocol validated) and **after Phase 2** (abstraction validated against a second dialect). Treat Phases 3–6 as pencil until those two clear.

## Parking lot (explicitly out of scope for now)

Cloud / background agents · own-harness BYOK "Composer" mode · semantic codebase index (agentic ripgrep/tree-sitter search is enough) · non-ACP agents · mobile.
