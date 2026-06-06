# JIRA REST Custom Statuses — Design

**Status:** Approved design, pre-implementation
**Date:** 2026-06-06
**Scope:** Add an optional, additive JIRA Cloud REST layer (gated on a user-provided API token stored in the macOS Keychain) so the app supports **custom per-project workflows**: the work-item status dropdown offers an issue's legal transitions, the board gains a multi-select status filter, and the board renders every custom status column (even empty ones). `acli` remains the base integration; REST only lights up these features when a token is connected.

---

## 1. Problem & motivation

Today the JIRA integration is `acli`-only. The work-item status dropdown (`src/components/JiraWorkItemDialog.tsx`) is populated from `statusOptions` in `src/components/JiraBoardPage.tsx:106`, which is `columns.map(c => c.statusName)` — and `columns` come from `deriveColumns(items)` in `src/hooks/useJira.ts:25`, i.e. **only the statuses that currently have at least one card on the board.**

Consequence (the reported bug): when every loaded item shares one status (e.g. all "To Do"), the dropdown has a single option — the current status — so the user cannot move an item to any other status from the app.

Investigation confirmed this is not fixable with `acli`:

- `acli jira workitem transition` has no list/enumerate mode; an invalid `--status` errors ("No allowed transitions found") without listing valid ones.
- `acli jira workitem view --json` returns `transitions: null` (acli's expand set excludes transitions; no flag adds it).
- `acli jira project view --json` carries no `statuses`; there is no raw REST passthrough.
- `acli`'s own auth is browser OAuth with no way to print/borrow a usable token.

Alternative CLIs (`ankitpokhrel/jira-cli`, `go-jira`) were evaluated and rejected: none expose a non-interactive "list transitions" command, all still require a user-created API token (often stored plaintext), and each adds a bundled-binary dependency on the minimal GUI PATH. Since custom-status support requires a token regardless, calling REST directly is fewer moving parts than driving a second CLI.

The only source of truth for a custom project's statuses and an issue's legal moves is JIRA's REST API. Reaching it requires a credential, which is a deliberate, contained softening of the "no app-managed tokens" rule — limited to an opt-in, user-revocable API token kept in the OS Keychain.

## 2. Locked decisions

Settled during brainstorming; constrain the rest of the design:

1. **Additive & optional.** `acli` stays the base. REST features activate only when a token is connected. With no token, behavior is exactly as today (item-derived columns, derived dropdown options, acli transition).
2. **API token, Basic auth.** User pastes an Atlassian API token (`id.atlassian.com/manage/api-tokens`). Auth is `Authorization: Basic base64(email:token)` to `https://{site}/rest/api/3/...`. No OAuth 3LO.
3. **Secret in Keychain only.** The token lives in the macOS Keychain (`keyring` crate), never in SQLite. `AppSettings` stores only non-secret fields.
4. **Site + email auto-detected from `acli`.** `acli jira auth status` already reports both; we parse and prefill them, editable in Settings. Only the token is hand-entered.
5. **Execution via REST when connected.** The actual move uses `POST /issue/{key}/transitions` with the transition id (canonical; avoids acli's status-name resolution ambiguity). Falls back to `acli` transition when no token.
6. **New crates:** `ureq` (blocking HTTP + rustls — fits the existing `spawn_blocking` pattern, no tokio) and `keyring` v3 (macOS Keychain).
7. **v1 surfaces:** (a) legal-transition status dropdown, (b) board multi-select status filter, (c) all custom status columns rendered including empty ones. All three ride the same REST + Keychain foundation.
8. **Single site for v1**, matching the existing acli integration's single-site assumption.

## 3. REST capability basis (verified against current Atlassian docs)

- **Validate token / connection:** `GET /rest/api/3/myself` → 200 with the account; used by the Settings "test & save" path.
- **Legal transitions (dropdown):** `GET /rest/api/3/issue/{key}/transitions` →
  `{ "transitions": [ { "id": "21", "name": "In Progress", "to": { "name": "In Progress", "statusCategory": {…} } } ] }`.
  Returns only transitions legal from the issue's current status.
- **Perform move:** `POST /rest/api/3/issue/{key}/transitions`, body `{ "transition": { "id": "<id>" } }` → 204.
- **Project status set (filter options + columns):** `GET /rest/api/3/project/{projectIdOrKey}/statuses` → an array of issue types, each with a `statuses: [{ id, name, statusCategory? }]`. **We union statuses across all issue types** to get the project's full column/filter set. Requires only the *Browse Projects* permission.

`statusCategory` may be absent on some status objects from `/project/statuses`; map it when present, otherwise fall back to the existing name-based heuristic (`map_category` in `native/src/jira.rs`).

## 4. Architecture overview

Mirrors the existing `acli`/`gh` integration shape; REST is a parallel, optional path.

```
Frontend (React/TS)                Backend (Rust/Tauri)                       External
───────────────────                ────────────────────                       ────────
SettingsView (token card) ─┐       set/clear/jira_rest_status ──► jira_rest.rs ──► JIRA Cloud REST
useJira hook             ──┼─ api.ts ─► jira_list_transitions    │  (ureq, Basic auth)   (https://{site})
JiraWorkItemPanel        ──┤          jira_project_statuses      │
JiraBoardPage (filter)   ──┘          jira_transition (REST-aware)└─ keyring (Keychain: token)
                                      acli path (jira.rs) unchanged for search/create/assign/comment
                                      SQLite: app_settings.jira_rest_email, jira_filter_statuses
```

**Module split:** new `native/src/jira_rest.rs` holds the REST client and pure parse functions, kept separate from the acli-based `native/src/jira.rs`. The token/Keychain helper lives in a small `native/src/jira_secret.rs` (or a submodule of `jira_rest`) so the secret boundary is isolated and testable in shape.

## 5. Auth & connection model

- **Inputs:** site (prefilled from `acli`, editable), email (prefilled from `acli`, editable), token (entered).
- **`parse_auth_site` extended** (or a sibling `parse_auth_email`) to also extract the `Email:` line from `acli jira auth status` output.
- **Save flow:** `set_jira_api_token(site, email, token)` → call `GET /myself` with the credentials → on 200, store token in Keychain (service = the app bundle identifier from `tauri.conf.json`, account = `jira-api-token:{site}`) and persist `jira_rest_email` + site (reusing existing `jira_site_url`); on failure, return an error and store nothing.
- **Status:** `jira_rest_status()` → `JiraRestStatus { connected: bool, site: Option<String>, email: Option<String>, error: Option<String> }`. `connected` is computed (token present in Keychain for the site); a cheap call may be deferred to actual feature use rather than pinging `/myself` on every board load.
- **Disconnect:** `clear_jira_api_token()` removes the Keychain entry; features revert to the acli/derived path.

## 6. Data types (added to `native/src/models/jira.rs`, re-exported from `models/mod.rs`)

```
JiraTransition  { id: String, name: String, to_status_name: String, to_status_category: JiraStatusCategory }
JiraStatusDef   { id: String, name: String, category: JiraStatusCategory }   // a project status
JiraRestStatus  { connected: bool, site: Option<String>, email: Option<String>, error: Option<String> }
```

All `#[serde(rename_all = "camelCase")]`, matching existing models and `src/types.ts`.

## 7. New / changed Tauri commands (`native/src/lib.rs`)

- `set_jira_api_token(site: String, email: String, token: String) -> AppResult<JiraRestStatus>`
- `clear_jira_api_token() -> AppResult<()>`
- `jira_rest_status() -> AppResult<JiraRestStatus>`
- `jira_list_transitions(key: String) -> AppResult<Vec<JiraTransition>>`
- `jira_project_statuses(project: String) -> AppResult<Vec<JiraStatusDef>>`
- `jira_transition_work_item(key, status)` — **made REST-aware:** when connected, resolve the target status name to a transition id via `list_transitions` and `POST` it; otherwise call the existing `jira::transition` (acli). Signature unchanged so the frontend's optimistic flow is untouched.

All REST commands run in `tauri::async_runtime::spawn_blocking` (consistent with the existing jira commands), since `ureq` and `keyring` are blocking.

## 8. Settings & persistence changes

- **`AppSettings` / `AppSettingsInput`** (`native/src/models/settings.rs`) gain:
  - `jira_rest_email: Option<String>` (non-secret; Basic-auth username).
  - `jira_filter_statuses: Vec<String>` (board status-filter selection).
  - Token is **not** here — Keychain only. A derived `jiraRestConnected` is exposed via `jira_rest_status`, not stored.
- **SQLite migration** (`native/src/db/`): add `jira_rest_email TEXT` and `jira_filter_statuses TEXT` (JSON-encoded list) columns to the settings table, with the additive-migration pattern already used for the earlier `jira_*` columns. Row mapping updated; persistence tests extended.

## 9. Frontend changes

- **`src/types.ts`:** add `JiraTransition`, `JiraStatusDef`, `JiraRestStatus`; extend `AppSettings` with the two new fields.
- **`src/api.ts`:** typed wrappers for the new commands.
- **Settings UI** (`src/components/settings/`): a "JIRA API token" card — prefilled site/email (editable), token field (password input), Test & Save / Disconnect, connection state. Built from shadcn primitives (`Field`, `Input`, `Button`, `Alert`/`Badge`), no custom controls.
- **`src/hooks/useJira.ts`:**
  - Load `jira_rest_status` once when the view is active; expose `restConnected`.
  - When connected, fetch `jira_project_statuses(project)` (cached per project) → `projectStatuses`.
  - `deriveColumns` gains a connected variant: column skeleton = union of project statuses ordered by `CATEGORY_ORDER` then name (reusing existing ordering), items bucketed in, empty statuses kept. An active filter narrows the skeleton to the selected statuses. No token → current item-derived behavior.
  - `transition` unchanged at the hook layer (the command is REST-aware backend-side).
- **`src/components/JiraWorkItemDialog.tsx`:** when connected, the dropdown options come from `jira_list_transitions(key)` (fetched on open) instead of `statusOptions`; otherwise the current derived options. Loading/empty states handled.
- **`src/components/JiraBoardPage.tsx`:** a multi-select status filter in the board header beside the existing toggles; selection persists to `jira_filter_statuses` and flows into the board query.
- **`build_board_jql`** (`native/src/jira.rs`): accept the selected statuses and append `status in ("A","B")` (quotes escaped like the project key). Unit-tested. The board search command passes `settings.jira_filter_statuses`.

## 10. Error handling & degradation

- **Token verify failure (401/403):** surfaced in the Settings card; token not saved.
- **Per-call REST failure:** mapped through `command_error`-style messages, surfaced via `setMessage` toast, identical UX to the acli path. The transition keeps the existing optimistic-move-then-revert in `useJira.transition`.
- **Token later revoked:** REST features detect the failure and degrade to the acli/derived path; the user is nudged to reconnect via the Settings card.
- **No `acli` connection:** site/email auto-detect is unavailable; the Settings card still allows manual entry, so REST can work standalone if desired.

## 11. Testing strategy

- **Rust unit tests (`jira_rest.rs`):** fixture-based parse tests for `GET /issue/{key}/transitions` and `GET /project/{key}/statuses` JSON (golden fixtures under `native/src/jira_fixtures/`, mirroring the existing acli fixtures), including the union-across-issue-types and `statusCategory`-absent cases.
- **Rust (`jira.rs`):** `build_board_jql` status-clause tests (single, multiple, quote-escaping, empty selection → no clause).
- **Rust (`models/settings`, `db`):** round-trip persistence of the two new settings fields and the migration.
- **Frontend:** extend `useJira`/board tests — dropdown renders REST transitions when connected; columns include empty project statuses; filter selection compiles and persists; all three fall back correctly with no token. Settings card test for the save/verify/disconnect flow.
- The thin `ureq`/`keyring` request and Keychain wrappers stay minimal and are not unit-tested directly (same stance as the acli shell-out wrappers).

## 12. Documentation updates (same change)

- `docs/jira-integration.md`: the optional REST layer — token setup, Keychain storage, which features it enables, the acli-vs-REST split, and the `/issue/transitions` + `/project/statuses` + `POST transition` usage.
- `docs/features.md`: custom-status dropdown, board status filter, empty-column rendering, and the token-optional connection model.
- `docs/tracking-and-debugging.md`: new settings columns, Keychain entry, new commands, and REST failure modes.
- `README.md` / `CLAUDE.md`: note the additive, token-optional REST layer and that the "no app-managed tokens" default now has a deliberate, Keychain-scoped opt-in for custom-workflow JIRA.

## 13. Build order (detailed plan via writing-plans)

1. Crates + `jira_rest.rs` skeleton + parse functions + fixtures (pure, unit-tested).
2. Keychain secret helper + `set/clear/jira_rest_status` commands.
3. Settings model + DB migration + persistence tests.
4. `jira_list_transitions`, `jira_project_statuses`, REST-aware `jira_transition_work_item`.
5. `build_board_jql` status clause + board search wiring.
6. Frontend: types/api, Settings token card.
7. Frontend: dropdown (REST transitions), columns (project statuses + empty), status filter.
8. Docs + full verification (`pnpm test`, `pnpm build`, `cargo test`).

## 14. Non-goals (v1)

- Multi-site / multi-account REST.
- Replacing `acli` for search/create/assign/comment (REST is additive only).
- Transition screens / required fields on transition (we send only `{ transition: { id } }`; a transition that requires a screen field surfaces as a REST error, handled like any other failure).
- OAuth 3LO and bulk transitions.
