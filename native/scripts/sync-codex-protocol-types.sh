#!/usr/bin/env bash
#
# Prints the upstream codex-protocol type definitions that we vendor in
# native/src/sessions/codex.rs, fetched at the git tag matching the installed
# Codex CLI.
#
# We mirror these types by hand because the codex-protocol crate can't be a
# dependency here: it drags in the whole Codex runtime (Starlark, networking,
# image decoding) and its dependency tree has a hashbrown/allocative version
# conflict that fails to build (see the header comment in codex.rs). Run this
# after upgrading the Codex CLI to eyeball whether any type/field the watcher
# reads has drifted.
#
# Usage:
#   native/scripts/sync-codex-protocol-types.sh                # tag from `codex --version`
#   native/scripts/sync-codex-protocol-types.sh rust-v0.137.0  # explicit tag
#   CODEX_PROTOCOL_TAG=rust-v0.137.0 native/scripts/sync-codex-protocol-types.sh
#
set -euo pipefail

vendored_rel="native/src/sessions/codex.rs"

tag="${1:-${CODEX_PROTOCOL_TAG:-}}"
if [[ -z "$tag" ]]; then
  if ! command -v codex >/dev/null 2>&1; then
    echo "error: codex CLI not on PATH; pass a tag, e.g. $(basename "$0") rust-v0.136.0" >&2
    exit 1
  fi
  tag="rust-v$(codex --version | awk '{print $NF}')"
fi

base="https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/protocol/src"
echo "codex-protocol source @ ${tag}"
echo "  ${base}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for f in protocol.rs models.rs approvals.rs request_user_input.rs request_permissions.rs; do
  if ! curl -fsSL "${base}/${f}" -o "${tmp}/${f}"; then
    echo "error: could not fetch ${base}/${f} (tag missing or files moved upstream?)" >&2
    exit 1
  fi
done

section() { printf '\n========== %s ==========\n' "$1"; }
# show <file> <pattern> <lines-after>
show() { grep -E -A"$3" -- "$2" "${tmp}/$1" || echo "  (not found — upstream may have renamed it)"; }

section "RolloutLine / RolloutItem  (protocol.rs)"
show protocol.rs 'pub struct RolloutLine' 5
show protocol.rs 'pub enum RolloutItem' 8

section "EventMsg variants + task_*/turn_* aliases  (protocol.rs)"
grep -E -B1 \
  'TurnComplete\(|TurnStarted\(|TurnAborted\(|ExecApprovalRequest\(|ApplyPatchApprovalRequest\(|RequestUserInput\(|ElicitationRequest\(|RequestPermissions\(' \
  "${tmp}/protocol.rs" || true

section "Turn lifecycle event structs  (protocol.rs)"
show protocol.rs 'pub struct TurnCompleteEvent' 5
show protocol.rs 'pub struct TurnStartedEvent' 5
show protocol.rs 'pub struct TurnAbortedEvent' 5
show protocol.rs 'pub enum TurnAbortReason' 7

section "SessionMeta  (protocol.rs)"
show protocol.rs 'pub struct SessionMeta ' 20

section "ResponseItem::FunctionCall  (models.rs)"
grep -E -A8 'FunctionCall \{' "${tmp}/models.rs" | head -n 12 || true

section "Input-request events  (approvals / request_user_input / request_permissions)"
show approvals.rs 'pub struct ExecApprovalRequestEvent' 4
show approvals.rs 'pub struct ElicitationRequestEvent' 4
show request_user_input.rs 'pub struct RequestUserInputEvent' 4
show request_permissions.rs 'pub struct RequestPermissionsEvent' 4

cat <<EOF

Compare the above with the vendored block in ${vendored_rel}
(search for "Vendored Codex rollout types").

Most CLI bumps need no change — the vendored structs use #[serde(other)] and
optional fields. Only edit when a variant you map (turn_complete / the approval
set) is renamed, or a field the watcher reads is added/moved/removed.
EOF
