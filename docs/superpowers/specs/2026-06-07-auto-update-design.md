# In-App Auto Update via GitHub Releases — Design

- **Date:** 2026-06-07
- **Status:** Approved (pending spec review)
- **Topic:** Ship a Tauri 2 auto-updater for Nectus Desktop. Releases are built,
  signed, and published by GitHub Actions on a version tag; the app checks GitHub
  Releases for a newer version and lets the user download, install, and relaunch
  from both a launch toast and a Settings **About** card.

## Problem

Nectus Desktop has no update path. `desktop:build` produces a `.app` + `.dmg`
locally, there is no `.github/workflows/`, no release automation, and no way for
an installed copy to learn that a newer version exists. Every update today is a
manual rebuild-and-reinstall. We want one-tag releases and an in-app update
experience.

## Confirmed decisions (from brainstorming)

- **No Apple Developer ID.** Ship **unsigned / un-notarized**. Update integrity
  is secured by Tauri's own **minisign** keypair (independent of Apple). The
  first download shows the usual Gatekeeper "cannot verify" warning; this is
  accepted. Apple notarization is a clean future add-on, explicitly out of scope.
- **In-app UX = both** (brainstorm option A): a silent check shortly after
  launch surfaces a non-blocking `sonner` toast when an update exists, **and** a
  Settings **About** card offers a manual "Check for updates" plus the same
  install/relaunch flow.
- **Apple Silicon only** (`aarch64-apple-darwin`) for now. No Intel/universal.
- **Repo is public** (`github.com/hvp17/nectus`), so the updater reads
  `releases/latest/download/latest.json` directly — no embedded token.
- **Release flow = tag → auto-published release** (brainstorm option B). Pushing
  a `v*` tag triggers CI that builds, signs, and **auto-publishes** the GitHub
  Release (no draft gate).
- **Architecture = frontend-driven** (brainstorm Approach 1). Rust only registers
  the `updater` + `process` plugins and capabilities; all check/download/install/
  relaunch logic lives in the frontend via the official JS plugin API, and
  no-ops outside Tauri so browser preview and the test runner are unaffected.

## Architecture

The official `tauri-plugin-updater` reads a signed `latest.json` manifest from
GitHub Releases, verifies each artifact against the committed minisign **public
key**, downloads the `.app.tar.gz`, swaps the bundle in place, and relaunches via
`tauri-plugin-process`. CI signs artifacts with the **private key** held only in
GitHub secrets. The frontend drives the whole flow with the plugin's JS API.

```
git tag vX.Y.Z ──push──▶ GitHub Actions (release.yml, macos-latest/arm64)
                          tauri-action: pnpm build → tauri build (signed)
                          → publishes Release: .dmg, .app.tar.gz, .sig, latest.json
                                                         │
Installed app ──check()──▶ releases/latest/download/latest.json
            ◀─ Update{version,notes,date} | null ──────┘
            downloadAndInstall(onProgress) → verify sig vs pubkey → relaunch()
```

## Component design

### A. Dependencies & plugin registration

- `native/Cargo.toml`: add `tauri-plugin-updater = "2"` and
  `tauri-plugin-process = "2"`.
- `package.json`: add `@tauri-apps/plugin-updater` and
  `@tauri-apps/plugin-process` (match the existing `^2` plugin pinning).
- `native/src/lib.rs` `run()` builder: add
  `.plugin(tauri_plugin_updater::Builder::new().build())` and
  `.plugin(tauri_plugin_process::init())` alongside the existing dialog/
  notification/opener plugins.

### B. Config & capabilities

- `native/tauri.conf.json`:
  - `bundle.createUpdaterArtifacts: true` — makes `tauri build` emit
    `Nectus Desktop.app.tar.gz` + `.sig` for the updater.
  - `plugins.updater`:
    ```json
    {
      "endpoints": ["https://github.com/hvp17/nectus/releases/latest/download/latest.json"],
      "pubkey": "<minisign public key, base64>"
    }
    ```
- `native/capabilities/default.json`: add `"updater:default"` and
  `"process:allow-restart"` to the `permissions` array.

### C. Signing keys

- Generate a minisign keypair with `pnpm tauri signer generate` (password
  protected) during implementation.
- The **public** key is committed into `tauri.conf.json` `plugins.updater.pubkey`.
- The **private key + password** are delivered to the user to store as GitHub
  repo secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The private key is **never committed**;
  the implementer verifies via `git diff` / `.gitignore` that no key material is
  staged.

### D. CI release workflow — `.github/workflows/release.yml`

- **Trigger:** `push` of tags matching `v*`.
- **Runner:** `macos-latest` (arm64); Rust target `aarch64-apple-darwin`.
- **Steps:** checkout → `actions/setup-node` (Node 20) → `pnpm/action-setup`
  (pnpm 11) → `pnpm install` → `dtolnay/rust-toolchain@stable` with the
  `aarch64-apple-darwin` target → `tauri-apps/tauri-action@v0`.
- **tauri-action inputs/env:**
  - env: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`,
    `TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}`,
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}`.
  - `tagName: ${{ github.ref_name }}`, `releaseName: 'Nectus Desktop __VERSION__'`,
    `releaseDraft: false`, `prerelease: false`,
    `args: --config native/tauri.conf.json` (the config lives in `native/`, not
    the repo root, so the build must be pointed at it).
- tauri-action builds, signs each updater artifact, generates `latest.json`
  (platform key `darwin-aarch64`), and uploads the `.dmg`, `.app.tar.gz`, `.sig`,
  and `latest.json` to the auto-published release.

### E. Frontend — the in-app experience

- `src/lib/update.ts`: a thin wrapper over `@tauri-apps/plugin-updater`'s
  `check()` and the returned `Update`'s `downloadAndInstall()`, plus
  `@tauri-apps/plugin-process` `relaunch()`. Guarded by the app's existing
  Tauri-availability check so every export no-ops (returns "unavailable")
  outside Tauri — keeping browser preview and Vitest clean. Exposes a typed
  shape: `{ available, version, currentVersion, notes, date }` and an
  install function that streams download progress to a callback.
- `src/hooks/useAppUpdate.ts`: owns the update state machine
  `idle | checking | upToDate | available | downloading{progress} | ready | error`,
  runs one silent `check()` shortly after launch, and exposes `check()` and
  `installAndRelaunch()`. Follows the existing hook conventions in `src/hooks/`.
- **Launch UX:** on transition to `available`, raise a non-blocking `sonner`
  toast — "Update available (vX.Y.Z)" with an **Install** action. Install shows
  progress in the toast and, on `ready`, offers **Relaunch to finish**. No modal,
  no forced interruption.
- **Settings UX:** a new **About** section in `src/components/SettingsPage.tsx`,
  added to the section nav (`SettingsSectionId`) and the overview list. The card
  shows the current version (`@tauri-apps/api/app` `getVersion()`), a **Check for
  updates** button, the last-checked time, and the available/downloading/ready
  status with the same install + relaunch actions. Built from existing shadcn
  primitives (`Card`, `Button`, `Badge`) and `nx-` styling — **no new colors or
  hex**, per the theme-token rule.

### F. Versioning & release flow (documented)

- The app version source of truth is `tauri.conf.json` `version`; keep
  `package.json` and `native/Cargo.toml` in sync with it.
- To cut a release: bump all three to `X.Y.Z`, commit, `git tag vX.Y.Z`,
  `git push --tags`. CI builds, signs, and auto-publishes; installed apps pick it
  up on their next launch check.
- Docs updated in the same change:
  - `README.md` — release process, auto-update overview, and the one-time
    GitHub-secret setup.
  - `docs/features.md` — the in-app update experience and where it lives.
  - `docs/tracking-and-debugging.md` — update states/events and how to debug a
    failed check (endpoint URL, `latest.json` shape, pubkey mismatch symptoms).

## Testing

- **Frontend (Vitest):** unit-test the `useAppUpdate` state machine and the
  `update.ts` no-op-outside-Tauri guard with the plugin modules mocked, matching
  the existing hook/test style. Gate: `pnpm test` + `pnpm build` green.
- **Rust:** `cargo test`. Plugin registration and config are compile-checked;
  there is no new Rust logic to unit-test.
- **Boundary explicitly not auto-verified:** the live GitHub fetch +
  signature-verified in-place install cannot be exercised end-to-end without a
  real published release on a real prior install. This is called out rather than
  claimed as verified; the first real `v*` tag is the true end-to-end check.

## Out of scope (deliberate)

- Apple notarization / Developer ID signing (clean future add-on; the minisign
  layer that secures updates is already present).
- Windows, Linux, and Intel/universal macOS targets.
- Background/interval polling beyond the single launch check + manual button.
- Rich in-app release-notes rendering beyond version + short notes text.
- Rollback/downgrade and staged/percentage rollouts.

## Risks & caveats

- **Unsigned first run:** users must right-click-open past Gatekeeper on first
  install. Documented; not solvable without an Apple cert.
- **Tag/version drift:** if `tauri.conf.json` version isn't bumped to match the
  tag, the published `latest.json` version may not advertise an upgrade. The
  release flow doc makes the three-file bump explicit; a future enhancement could
  derive the version from the tag in CI.
- **Config path:** the non-default `native/tauri.conf.json` location means both
  the updater config and the CI `--config` arg must point there; missing it is
  the most likely setup error.
