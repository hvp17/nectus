# In-App Auto Update via GitHub Releases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Nectus Desktop a Tauri 2 auto-updater that reads signed releases from GitHub, surfaced in-app via a launch toast and a Settings **About** card, with a tag-triggered GitHub Actions workflow that builds, signs, and auto-publishes each release.

**Architecture:** The official `tauri-plugin-updater` reads a signed `latest.json` from GitHub Releases (public repo, no token), verifies artifacts against a committed minisign public key, downloads the `.app.tar.gz`, swaps the bundle in place, and relaunches via `tauri-plugin-process`. Rust only registers the two plugins and their capabilities; all check/download/install/relaunch logic lives frontend-side in a thin `src/lib/update.ts` wrapper that no-ops outside Tauri, a `useAppUpdate` state-machine hook, a `useAppUpdateToast` launch-toast hook, and a Settings `UpdateCard`. CI signs with a private key held only in GitHub secrets.

**Tech Stack:** Tauri 2 (`tauri-plugin-updater`, `tauri-plugin-process`), React + TypeScript, Vitest, `sonner` toasts, shadcn primitives, `tauri-apps/tauri-action` (GitHub Actions).

**Spec:** `docs/superpowers/specs/2026-06-07-auto-update-design.md`

---

## File map

| File | Responsibility | Action |
| --- | --- | --- |
| `native/Cargo.toml` | Add `tauri-plugin-updater`, `tauri-plugin-process` | Modify |
| `package.json` | Add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` | Modify |
| `native/src/lib.rs` | Register the two plugins in `run()` | Modify |
| `native/tauri.conf.json` | `bundle.createUpdaterArtifacts`, `plugins.updater` (endpoints + pubkey) | Modify |
| `native/capabilities/default.json` | Add `updater:default`, `process:allow-restart` | Modify |
| `src/lib/update.ts` | Tauri-guarded wrapper over the updater + process plugin JS APIs | Create |
| `src/lib/update.test.ts` | Unit tests for the wrapper (mocked plugins) | Create |
| `src/hooks/useAppUpdate.ts` | Update state machine + launch check | Create |
| `src/hooks/useAppUpdate.test.tsx` | Unit tests for the state machine (mocked lib) | Create |
| `src/hooks/useAppUpdateToast.ts` | Fires the launch "update available / installed" toasts | Create |
| `src/hooks/useAppUpdateToast.test.tsx` | Unit tests for the toast hook (mocked sonner) | Create |
| `src/components/settings/UpdateCard.tsx` | Presentational About/update card | Create |
| `src/components/settings/UpdateCard.test.tsx` | Component tests | Create |
| `src/components/SettingsPage.tsx` | New **About** section + `appUpdate` prop | Modify |
| `src/App.tsx` | Mount `useAppUpdate` + `useAppUpdateToast`, thread `appUpdate` to Settings | Modify |
| `.github/workflows/release.yml` | Tag-triggered build/sign/publish | Create |
| `README.md`, `docs/features.md`, `docs/tracking-and-debugging.md`, `CLAUDE.md` | Docs | Modify |

**Canonical types (defined in `src/lib/update.ts`, reused everywhere):**

```ts
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}
export interface DownloadProgress {
  downloaded: number;
  contentLength: number | null;
}
export interface UpdateCheckResult {
  info: UpdateInfo;
  update: import("@tauri-apps/plugin-updater").Update;
}
```

```ts
// src/hooks/useAppUpdate.ts
export type UpdateStatus =
  | "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "error";
export interface AppUpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  currentVersion: string | null;
  progress: number | null;   // 0..1 while downloading, else null
  error: string | null;
  lastCheckedAt: number | null;
  check: (options?: { silent?: boolean }) => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunch: () => Promise<void>;
}
```

---

## Task 1: Register the updater + process plugins

**Files:**
- Modify: `native/Cargo.toml` (`[dependencies]`)
- Modify: `package.json` (`dependencies`)
- Modify: `native/src/lib.rs:1128-1131` (the `tauri::Builder` `.plugin(...)` chain)

- [ ] **Step 1: Add the Rust dependencies**

In `native/Cargo.toml`, under `[dependencies]`, add after the existing `tauri-plugin-opener = "2"` line:

```toml
tauri-plugin-process = "2"
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Register the plugins in `run()`**

In `native/src/lib.rs`, change the plugin chain inside `pub fn run()`:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
```

- [ ] **Step 3: Add the JS dependencies**

Run:

```bash
pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

Expected: `package.json` gains both under `dependencies` (a `^2` range), `pnpm-lock.yaml` updates.

- [ ] **Step 4: Verify the Rust side compiles**

Run:

```bash
cd native && cargo build
```

Expected: builds successfully, downloading `tauri-plugin-updater` / `tauri-plugin-process`. (Capabilities are not yet referencing them, so this passes.)

- [ ] **Step 5: Commit**

```bash
git add native/Cargo.toml native/Cargo.lock native/src/lib.rs package.json pnpm-lock.yaml
git commit -m "feat(update): register tauri updater and process plugins"
```

---

## Task 2: Configure the updater + capabilities + signing key

**Files:**
- Modify: `native/tauri.conf.json` (`bundle`, new `plugins` key)
- Modify: `native/capabilities/default.json` (`permissions`)

> **Note on the key:** Step 1 generates a minisign keypair. The **public** key is committed (in `tauri.conf.json`); the **private** key + password are handed to the user as GitHub secrets and **never committed**. The implementer runs Step 1, captures the printed public key, and pastes it into Step 2's `pubkey` field.

- [ ] **Step 1: Generate the signing keypair (outside the repo)**

Run (choose and remember a password when prompted, or pass `--password`):

```bash
pnpm tauri signer generate --write-keys "$HOME/.tauri/nectus_updater.key" --password "REPLACE_WITH_STRONG_PASSWORD"
```

Expected output includes a base64 **public key** (printed to stdout) and writes the private key to `~/.tauri/nectus_updater.key` plus `~/.tauri/nectus_updater.key.pub`. Capture:
- the **public key** string → used in Step 2.
- the **private key** file contents (`cat ~/.tauri/nectus_updater.key`) and the password → delivered to the user for GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Confirm the key path is **outside the repo** so it can never be committed.

- [ ] **Step 2: Configure the updater in `tauri.conf.json`**

In `native/tauri.conf.json`, set `bundle.createUpdaterArtifacts` and add a top-level `plugins` block. The file becomes:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Nectus Desktop",
  "version": "0.1.0",
  "identifier": "com.hvp17.nectus",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Nectus Desktop",
        "width": 1440,
        "height": 920,
        "minWidth": 1120,
        "minHeight": 720,
        "dragDropEnabled": true,
        "theme": "Dark"
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/hvp17/nectus/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_PUBLIC_KEY_FROM_STEP_1"
    }
  }
}
```

- [ ] **Step 3: Grant the capabilities**

In `native/capabilities/default.json`, extend `permissions`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "notification:default",
    "opener:default",
    "updater:default",
    "process:allow-restart"
  ]
}
```

- [ ] **Step 4: Verify config + capabilities validate**

Run:

```bash
cd native && cargo build
```

Expected: the `tauri-build` build script validates the capability identifiers against the now-registered plugins and the build succeeds. A typo in a permission name (e.g. `process:restart`) would fail here.

- [ ] **Step 5: Verify the private key is not staged**

Run:

```bash
git status --porcelain && git diff --cached --name-only
```

Expected: no `*.key`, no key material, only `native/tauri.conf.json` and `native/capabilities/default.json` changed.

- [ ] **Step 6: Commit**

```bash
git add native/tauri.conf.json native/capabilities/default.json
git commit -m "feat(update): configure updater endpoint, pubkey, and capabilities"
```

---

## Task 3: `src/lib/update.ts` — Tauri-guarded plugin wrapper (TDD)

**Files:**
- Create: `src/lib/update.ts`
- Test: `src/lib/update.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/update.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updaterMock = vi.hoisted(() => ({ check: vi.fn() }));
const processMock = vi.hoisted(() => ({ relaunch: vi.fn() }));
const appMock = vi.hoisted(() => ({ getVersion: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updaterMock.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: processMock.relaunch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appMock.getVersion }));

import {
  checkForUpdate,
  getAppVersion,
  installUpdate,
  isUpdaterAvailable,
  relaunchApp,
} from "./update";

function setTauri(present: boolean) {
  if (present) (window as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("update lib", () => {
  beforeEach(() => {
    updaterMock.check.mockReset();
    processMock.relaunch.mockReset();
    appMock.getVersion.mockReset();
  });
  afterEach(() => setTauri(false));

  it("reports unavailable and no-ops outside Tauri", async () => {
    setTauri(false);
    expect(isUpdaterAvailable()).toBe(false);
    expect(await checkForUpdate()).toBeNull();
    expect(await getAppVersion()).toBeNull();
    await relaunchApp();
    expect(updaterMock.check).not.toHaveBeenCalled();
    expect(processMock.relaunch).not.toHaveBeenCalled();
  });

  it("returns null when no update is available", async () => {
    setTauri(true);
    updaterMock.check.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("maps an available update", async () => {
    setTauri(true);
    updaterMock.check.mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "Notes",
      date: "2026-06-07",
      downloadAndInstall: vi.fn(),
    });
    const result = await checkForUpdate();
    expect(result?.info).toEqual({
      version: "0.2.0",
      currentVersion: "0.1.0",
      notes: "Notes",
      date: "2026-06-07",
    });
  });

  it("streams download progress through installUpdate", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    });
    const progress: Array<{ downloaded: number; contentLength: number | null }> = [];
    await installUpdate({ downloadAndInstall } as never, (p) => progress.push(p));
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toEqual({ downloaded: 100, contentLength: 100 });
  });

  it("relaunches inside Tauri", async () => {
    setTauri(true);
    await relaunchApp();
    expect(processMock.relaunch).toHaveBeenCalledTimes(1);
  });

  it("reads the app version inside Tauri", async () => {
    setTauri(true);
    appMock.getVersion.mockResolvedValue("0.1.0");
    expect(await getAppVersion()).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/lib/update.test.ts`
Expected: FAIL — `./update` cannot be resolved / exports missing.

- [ ] **Step 3: Implement `src/lib/update.ts`**

```ts
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  contentLength: number | null;
}

export interface UpdateCheckResult {
  info: UpdateInfo;
  update: Update;
}

/** The updater only works inside the Tauri runtime; everywhere else (browser
 * preview, Vitest) every call below no-ops so the UI degrades cleanly. */
export function isUpdaterAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppVersion(): Promise<string | null> {
  if (!isUpdaterAvailable()) return null;
  return getVersion();
}

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  if (!isUpdaterAvailable()) return null;
  const update = await check();
  if (!update) return null;
  return {
    update,
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
      date: update.date ?? null,
    },
  };
}

export async function installUpdate(
  update: Update,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let contentLength: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        onProgress?.({ downloaded, contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, contentLength });
        break;
      case "Finished":
        onProgress?.({ downloaded, contentLength });
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  if (!isUpdaterAvailable()) return;
  await relaunch();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/lib/update.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/update.ts src/lib/update.test.ts
git commit -m "feat(update): add tauri-guarded updater wrapper"
```

---

## Task 4: `src/hooks/useAppUpdate.ts` — state machine (TDD)

**Files:**
- Create: `src/hooks/useAppUpdate.ts`
- Test: `src/hooks/useAppUpdate.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useAppUpdate.test.tsx`:

```tsx
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdate, type AppUpdateState } from "./useAppUpdate";
import type { UpdateCheckResult } from "../lib/update";

const lib = vi.hoisted(() => ({
  getAppVersion: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("../lib/update", () => ({
  getAppVersion: lib.getAppVersion,
  checkForUpdate: lib.checkForUpdate,
  installUpdate: lib.installUpdate,
  relaunchApp: lib.relaunchApp,
}));

let latest: AppUpdateState;
function Probe() {
  latest = useAppUpdate();
  return null;
}

const fakeResult = (): UpdateCheckResult => ({
  update: { downloadAndInstall: vi.fn() } as never,
  info: { version: "0.2.0", currentVersion: "0.1.0", notes: "n", date: null },
});

describe("useAppUpdate", () => {
  beforeEach(() => {
    lib.getAppVersion.mockResolvedValue("0.1.0");
    lib.checkForUpdate.mockResolvedValue(null);
    lib.installUpdate.mockResolvedValue(undefined);
    lib.relaunchApp.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("runs a silent launch check and resolves to upToDate", async () => {
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("upToDate"));
    expect(latest.currentVersion).toBe("0.1.0");
    expect(lib.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("moves to available when an update is found", async () => {
    lib.checkForUpdate.mockResolvedValue(fakeResult());
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    expect(latest.info?.version).toBe("0.2.0");
  });

  it("downloads then becomes ready, reporting progress", async () => {
    lib.checkForUpdate.mockResolvedValue(fakeResult());
    lib.installUpdate.mockImplementation(async (_u: unknown, onProgress: (p: unknown) => void) => {
      onProgress({ downloaded: 50, contentLength: 100 });
    });
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    await act(async () => {
      await latest.installUpdate();
    });
    expect(latest.status).toBe("ready");
    expect(lib.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("captures errors from a failed check", async () => {
    lib.checkForUpdate.mockRejectedValue(new Error("network down"));
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("error"));
    expect(latest.error).toContain("network down");
  });

  it("relaunches via the lib", async () => {
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("upToDate"));
    await act(async () => {
      await latest.relaunch();
    });
    expect(lib.relaunchApp).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/hooks/useAppUpdate.test.tsx`
Expected: FAIL — `./useAppUpdate` not found.

- [ ] **Step 3: Implement `src/hooks/useAppUpdate.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForUpdate,
  getAppVersion,
  installUpdate as runInstall,
  relaunchApp,
  type UpdateInfo,
} from "../lib/update";

export type UpdateStatus =
  | "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "error";

export interface AppUpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  currentVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  check: (options?: { silent?: boolean }) => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunch: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdate(): AppUpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const pending = useRef<Update | null>(null);

  const check = useCallback(async (_options?: { silent?: boolean }) => {
    setStatus("checking");
    setError(null);
    try {
      const result = await checkForUpdate();
      setLastCheckedAt(Date.now());
      if (!result) {
        pending.current = null;
        setInfo(null);
        setStatus("upToDate");
        return;
      }
      pending.current = result.update;
      setInfo(result.info);
      setStatus("available");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!pending.current) return;
    setStatus("downloading");
    setProgress(0);
    setError(null);
    try {
      await runInstall(pending.current, ({ downloaded, contentLength }) => {
        setProgress(contentLength ? Math.min(1, downloaded / contentLength) : null);
      });
      setProgress(1);
      setStatus("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  // One silent check shortly after launch. Outside Tauri the lib no-ops,
  // so this resolves to `upToDate` with no network and no UI noise.
  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((version) => {
      if (!cancelled) setCurrentVersion(version);
    });
    void check({ silent: true });
    return () => {
      cancelled = true;
    };
  }, [check]);

  return {
    status, info, currentVersion, progress, error, lastCheckedAt,
    check, installUpdate, relaunch,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/hooks/useAppUpdate.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAppUpdate.ts src/hooks/useAppUpdate.test.tsx
git commit -m "feat(update): add useAppUpdate state machine hook"
```

---

## Task 5: `src/hooks/useAppUpdateToast.ts` — launch toast (TDD)

**Files:**
- Create: `src/hooks/useAppUpdateToast.ts`
- Test: `src/hooks/useAppUpdateToast.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useAppUpdateToast.test.tsx` (mirrors `useTaskNotificationToast.test.tsx`):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "../components/ui/sonner";
import { useAppUpdateToast } from "./useAppUpdateToast";
import type { UpdateStatus } from "./useAppUpdate";
import type { UpdateInfo } from "../lib/update";

const info: UpdateInfo = { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null };

function Harness(props: {
  status: UpdateStatus;
  info: UpdateInfo | null;
  onInstall: () => void;
  onRelaunch: () => void;
}) {
  useAppUpdateToast(props);
  return <Toaster />;
}

describe("useAppUpdateToast", () => {
  it("shows an Install toast when an update is available", async () => {
    const onInstall = vi.fn();
    render(<Harness status="available" info={info} onInstall={onInstall} onRelaunch={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /install/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("shows a Relaunch toast when the update is ready", async () => {
    const onRelaunch = vi.fn();
    render(<Harness status="ready" info={info} onInstall={vi.fn()} onRelaunch={onRelaunch} />);
    fireEvent.click(await screen.findByRole("button", { name: /relaunch/i }));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while up to date", () => {
    render(<Harness status="upToDate" info={null} onInstall={vi.fn()} onRelaunch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /relaunch/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/hooks/useAppUpdateToast.test.tsx`
Expected: FAIL — `./useAppUpdateToast` not found.

- [ ] **Step 3: Implement `src/hooks/useAppUpdateToast.ts`**

```ts
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UpdateStatus } from "./useAppUpdate";
import type { UpdateInfo } from "../lib/update";

interface UseAppUpdateToastParams {
  status: UpdateStatus;
  info: UpdateInfo | null;
  onInstall: () => void;
  onRelaunch: () => void;
}

// Surfaces auto-update transitions as non-blocking sonner toasts: one when a
// newer version is available (Install action) and one when the download has
// installed and only a relaunch remains (Relaunch action). Each fires once per
// version so re-renders never duplicate it.
export function useAppUpdateToast({ status, info, onInstall, onRelaunch }: UseAppUpdateToastParams) {
  const availableShownFor = useRef<string | null>(null);
  const readyShownFor = useRef<string | null>(null);

  useEffect(() => {
    if (status === "available" && info && availableShownFor.current !== info.version) {
      availableShownFor.current = info.version;
      toast("Update available", {
        description: `Version ${info.version} is ready to install.`,
        duration: 10000,
        action: { label: "Install", onClick: onInstall },
      });
    }
  }, [status, info, onInstall]);

  useEffect(() => {
    if (status === "ready" && info && readyShownFor.current !== info.version) {
      readyShownFor.current = info.version;
      toast.success("Update installed", {
        description: "Relaunch Nectus to finish updating.",
        duration: Infinity,
        action: { label: "Relaunch", onClick: onRelaunch },
      });
    }
  }, [status, info, onRelaunch]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/hooks/useAppUpdateToast.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAppUpdateToast.ts src/hooks/useAppUpdateToast.test.tsx
git commit -m "feat(update): add launch update toast hook"
```

---

## Task 6: `src/components/settings/UpdateCard.tsx` — About card (TDD)

**Files:**
- Create: `src/components/settings/UpdateCard.tsx`
- Test: `src/components/settings/UpdateCard.test.tsx`

Uses the existing `nx-strip` settings vocabulary (like `GithubConnectionCard`) plus `Button` and `Badge`. No new colors; progress is rendered as text (no new progress primitive).

- [ ] **Step 1: Write the failing tests**

Create `src/components/settings/UpdateCard.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateCard } from "./UpdateCard";
import type { UpdateInfo } from "../../lib/update";

const info: UpdateInfo = { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null };

const baseProps = {
  status: "upToDate" as const,
  info: null,
  currentVersion: "0.1.0",
  progress: null,
  error: null,
  lastCheckedAt: null,
  onCheck: vi.fn(),
  onInstall: vi.fn(),
  onRelaunch: vi.fn(),
};

describe("UpdateCard", () => {
  it("shows the current version", () => {
    render(<UpdateCard {...baseProps} />);
    expect(screen.getByText(/0\.1\.0/)).toBeInTheDocument();
  });

  it("checks for updates on click", () => {
    const onCheck = vi.fn();
    render(<UpdateCard {...baseProps} onCheck={onCheck} />);
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it("offers Install when an update is available", () => {
    const onInstall = vi.fn();
    render(<UpdateCard {...baseProps} status="available" info={info} onInstall={onInstall} />);
    fireEvent.click(screen.getByRole("button", { name: /install 0\.2\.0/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("offers Relaunch when ready", () => {
    const onRelaunch = vi.fn();
    render(<UpdateCard {...baseProps} status="ready" info={info} onRelaunch={onRelaunch} />);
    fireEvent.click(screen.getByRole("button", { name: /relaunch/i }));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("shows download progress", () => {
    render(<UpdateCard {...baseProps} status="downloading" info={info} progress={0.42} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("shows an error message", () => {
    render(<UpdateCard {...baseProps} status="error" error="network down" />);
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/components/settings/UpdateCard.test.tsx`
Expected: FAIL — `./UpdateCard` not found.

- [ ] **Step 3: Implement `src/components/settings/UpdateCard.tsx`**

```tsx
import { DownloadCloud, RefreshCw, RotateCw } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { UpdateInfo } from "../../lib/update";
import type { UpdateStatus } from "../../hooks/useAppUpdate";

interface UpdateCardProps {
  status: UpdateStatus;
  info: UpdateInfo | null;
  currentVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  onCheck: () => void;
  onInstall: () => void;
  onRelaunch: () => void;
}

function statusLabel(status: UpdateStatus): string {
  switch (status) {
    case "checking": return "Checking…";
    case "available": return "Update available";
    case "downloading": return "Downloading…";
    case "ready": return "Ready to relaunch";
    case "error": return "Check failed";
    case "upToDate": return "Up to date";
    default: return "Idle";
  }
}

export function UpdateCard({
  status, info, currentVersion, progress, error, lastCheckedAt,
  onCheck, onInstall, onRelaunch,
}: UpdateCardProps) {
  const busy = status === "checking" || status === "downloading";
  const percent = progress === null ? null : Math.round(progress * 100);
  const detail = status === "error" && error
    ? error
    : status === "downloading" && percent !== null
      ? `Downloading version ${info?.version ?? ""}… ${percent}%`
      : status === "available" && info
        ? `Version ${info.version} is available.`
        : status === "ready"
          ? "Update installed — relaunch to finish."
          : lastCheckedAt
            ? `Last checked ${new Date(lastCheckedAt).toLocaleTimeString()}.`
            : "Check GitHub for a newer version.";

  return (
    <div className="nx-strip">
      <span className="nx-strip-ic">
        <DownloadCloud />
      </span>
      <span className="nx-strip-copy">
        <strong>Nectus Desktop {currentVersion ? `v${currentVersion}` : ""}</strong>
        <small>{detail}</small>
      </span>
      <span className="nx-strip-right">
        <Badge variant="outline" aria-label={`Update status: ${statusLabel(status)}`}>
          {statusLabel(status)}
        </Badge>
        {status === "available" && info ? (
          <Button type="button" size="sm" className="gap-2" onClick={onInstall}>
            <DownloadCloud data-icon="inline-start" />
            Install {info.version}
          </Button>
        ) : status === "ready" ? (
          <Button type="button" size="sm" className="gap-2" onClick={onRelaunch}>
            <RotateCw data-icon="inline-start" />
            Relaunch
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-2" disabled={busy} onClick={onCheck}>
            <RefreshCw data-icon="inline-start" />
            Check for updates
          </Button>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/components/settings/UpdateCard.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/UpdateCard.tsx src/components/settings/UpdateCard.test.tsx
git commit -m "feat(update): add settings update card"
```

---

## Task 7: Wire the About section + mount the hooks in App

**Files:**
- Modify: `src/components/SettingsPage.tsx` (new `about` section + `appUpdate` prop)
- Modify: `src/App.tsx` (mount `useAppUpdate` + `useAppUpdateToast`, pass `appUpdate`)

- [ ] **Step 1: Add the `appUpdate` prop and About section to SettingsPage**

In `src/components/SettingsPage.tsx`:

1. Add imports near the other settings imports:

```tsx
import { Info } from "lucide-react";
import { UpdateCard } from "./settings/UpdateCard";
import type { AppUpdateState } from "../hooks/useAppUpdate";
```

(Combine the `Info` import into the existing `lucide-react` import line: `import { Bot, GitBranch, Github, Info, KanbanSquare, Palette, Plus, Save, Terminal } from "lucide-react";`)

2. Extend the section id union (line 44):

```tsx
type SettingsSectionId = "profiles" | "projects" | "github" | "jira" | "appearance" | "about";
```

3. Add `appUpdate` to `SettingsPageProps` (after `jiraDetectedSite`):

```tsx
  appUpdate: AppUpdateState;
```

4. Destructure `appUpdate` in the component signature (after `jiraDetectedSite,`).

5. Add a nav item to the `navItems` array (after the `appearance` entry):

```tsx
    { id: "about", icon: <Info />, label: "About" },
```

6. Add an overview item after the Interface `SettingsOverviewItem` (line ~153):

```tsx
          <SettingsOverviewItem icon={<Info />} label="Version" value={appUpdate.currentVersion ? `v${appUpdate.currentVersion}` : "—"} />
```

7. Add the section after the `appearance` `</section>` (line ~342), before the closing `</div>` of `nx-set-scroll`:

```tsx
        <section id="settings-section-about" className="nx-set-section">
          <div className="nx-set-sec-head">
            <Info />
            <h3>About &amp; Updates</h3>
          </div>
          <div className="nx-set-sec-body">
            <UpdateCard
              status={appUpdate.status}
              info={appUpdate.info}
              currentVersion={appUpdate.currentVersion}
              progress={appUpdate.progress}
              error={appUpdate.error}
              lastCheckedAt={appUpdate.lastCheckedAt}
              onCheck={() => appUpdate.check()}
              onInstall={appUpdate.installUpdate}
              onRelaunch={appUpdate.relaunch}
            />
          </div>
        </section>
```

- [ ] **Step 2: Mount the hooks in App and thread the prop**

In `src/App.tsx`:

1. Add imports near the other hook imports:

```tsx
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useAppUpdateToast } from "./hooks/useAppUpdateToast";
```

2. Inside `function App()`, after the other top-level hooks (e.g. after `useTaskNotificationToast(...)` / near the `useApp()` destructure), add:

```tsx
  const appUpdate = useAppUpdate();
  useAppUpdateToast({
    status: appUpdate.status,
    info: appUpdate.info,
    onInstall: appUpdate.installUpdate,
    onRelaunch: appUpdate.relaunch,
  });
```

3. Pass it to `<SettingsPage>` (in the `currentView === "settings"` branch, line ~335):

```tsx
              appUpdate={appUpdate}
```

- [ ] **Step 3: Verify the full frontend suite + typecheck**

Run: `pnpm test`
Expected: PASS — all existing tests plus the new update tests. (App tests render the real `useAppUpdate`, which no-ops outside Tauri → `upToDate`, no toast, no crash.)

Run: `pnpm build`
Expected: `tsc` + `vite build` succeed (the new plugin JS types resolve).

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsPage.tsx src/App.tsx
git commit -m "feat(update): surface updates in settings about section and launch toast"
```

---

## Task 8: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: macos-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # No `version` input: package.json pins `packageManager: pnpm@11.1.1`, and
      # action-setup@v4 errors (ERR_PNPM_BAD_PM_VERSION) if a `version` input is
      # given that isn't byte-identical to that pin. Let it read the pin instead.
      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Cache cargo build
        uses: swatinem/rust-cache@v2
        with:
          workspaces: native -> target

      - name: Install frontend dependencies
        run: pnpm install

      - name: Build, sign, and publish release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Nectus Desktop __VERSION__"
          releaseBody: "Download the .dmg to install, or let an installed copy auto-update."
          releaseDraft: false
          prerelease: false
          args: --config native/tauri.conf.json --target aarch64-apple-darwin
```

- [ ] **Step 2: Lint the YAML locally**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('valid yaml')"
```

Expected: `valid yaml`.

> **CI cannot be run locally.** The true verification is the first `v*` tag push (Task 10). The likely failure modes are: missing repo secrets, or the `--config native/tauri.conf.json` path being wrong — both documented in Task 10.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered build, sign, and publish release"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md` (release + auto-update + secrets setup)
- Modify: `docs/features.md` (in-app update experience)
- Modify: `docs/tracking-and-debugging.md` (update states + debugging)
- Modify: `CLAUDE.md` (file map: new frontend files + plugins)

- [ ] **Step 1: README — add a "Releases & Auto-Update" section**

After the existing "Build And Release" section in `README.md`, add:

````markdown
## Releases & Auto-Update

Nectus Desktop auto-updates from GitHub Releases using the Tauri updater plugin.

**One-time setup (maintainer):** add two repository secrets (Settings → Secrets
and variables → Actions):

- `TAURI_SIGNING_PRIVATE_KEY` — the minisign private key generated with
  `pnpm tauri signer generate`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — that key's password.

The matching **public** key lives in `native/tauri.conf.json`
(`plugins.updater.pubkey`) and is safe to commit.

**Cut a release:**

1. Bump the version in `native/tauri.conf.json`, `package.json`, and
   `native/Cargo.toml` to the same `X.Y.Z`.
2. Commit, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. `.github/workflows/release.yml` builds the Apple-Silicon app, signs the
   updater artifacts, and **auto-publishes** a GitHub Release containing the
   `.dmg`, `.app.tar.gz`, `.sig`, and `latest.json`.

Installed copies check for a newer version on launch (and via Settings → About →
**Check for updates**) and offer a one-click install + relaunch.

**First run is unsigned:** the app is not Apple-notarized, so the first download
shows a Gatekeeper warning. Right-click the app → **Open** once to allow it.
Notarization is a future add-on and does not affect update integrity, which is
secured by the minisign signature.
````

- [ ] **Step 2: docs/features.md — document the update experience**

Add a subsection describing: the launch check + `sonner` "Update available → Install" toast, the "Update installed → Relaunch" toast, and the Settings → **About & Updates** card (current version, manual "Check for updates", install/relaunch). Note it lives in `src/hooks/useAppUpdate.ts`, `src/hooks/useAppUpdateToast.ts`, `src/lib/update.ts`, and `src/components/settings/UpdateCard.tsx`, and no-ops outside Tauri.

- [ ] **Step 3: docs/tracking-and-debugging.md — document states + debugging**

Add a subsection covering: the `UpdateStatus` values (`idle | checking | upToDate | available | downloading | ready | error`); the endpoint `https://github.com/hvp17/nectus/releases/latest/download/latest.json` and the expected `latest.json` shape (`version`, `platforms["darwin-aarch64"].{signature,url}`); and the common failure symptoms — a `pubkey` mismatch (signature verification fails on install), a missing/draft release (check returns "up to date" because `latest.json` 404s), and a version that is not higher than the installed one (no update offered).

- [ ] **Step 4: CLAUDE.md — extend the file map**

Under "Frontend Boundaries → Important frontend files", add entries for `src/lib/update.ts`, `src/hooks/useAppUpdate.ts`, `src/hooks/useAppUpdateToast.ts`, and `src/components/settings/UpdateCard.tsx`. Under "Backend Boundaries", note that `native/src/lib.rs` registers `tauri-plugin-updater` + `tauri-plugin-process`, and that `native/tauri.conf.json` carries the updater endpoint/pubkey and `native/capabilities/default.json` grants `updater:default` + `process:allow-restart`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/features.md docs/tracking-and-debugging.md CLAUDE.md
git commit -m "docs: document auto-update release flow and in-app experience"
```

---

## Task 10: Final verification + go-live handoff

**Files:** none (verification + handoff)

- [ ] **Step 1: Run the full verification set**

```bash
pnpm test
pnpm build
cd native && cargo test
```

Expected: all green. (`cargo test` compiles the registered plugins; there is no new Rust logic to unit-test.)

- [ ] **Step 2: Confirm no secret material is tracked**

```bash
git ls-files | grep -iE '\.key$|signing|private' || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Deliver the go-live handoff to the user**

This is a manual, human-in-the-loop step (cannot be automated by an agent):

1. **Add the two repo secrets** (`TAURI_SIGNING_PRIVATE_KEY`,
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) from the keypair generated in Task 2.
2. **Cut the first release:** bump the three version files (if shipping > 0.1.0),
   commit, `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. **Watch the Actions run** publish the release with `latest.json` attached.
4. **End-to-end check** (the one boundary not auto-verifiable): install the
   `vX.Y.Z` `.dmg`, then publish a `vX.Y.(Z+1)`; the installed app should show the
   "Update available" toast on next launch, install, and relaunch into the new
   version.

---

## Self-review notes

- **Spec coverage:** plugins/registration (Spec A → Task 1), config/capabilities (Spec B → Task 2), signing keys (Spec C → Task 2), CI workflow (Spec D → Task 8), frontend lib/hook/toast/settings (Spec E → Tasks 3–7), versioning/docs (Spec F → Task 9), testing (Spec G → Tasks 3–7, 10), out-of-scope items untouched. The end-to-end boundary the spec flags as not auto-verifiable is captured as the manual Task 10 Step 3.
- **Type consistency:** `UpdateInfo`/`DownloadProgress`/`UpdateCheckResult` are defined once in `update.ts` and imported by the hook, toast, and card. `AppUpdateState`/`UpdateStatus` are defined once in `useAppUpdate.ts` and reused by `useAppUpdateToast`, `UpdateCard`, and `SettingsPage`. The lib's `installUpdate(update, onProgress)` is wrapped by the hook's argument-less `installUpdate()` (imported `as runInstall` to avoid the name clash).
- **No placeholders** except the two intentional fill-on-execution tokens: the `pubkey` value (generated in Task 2 Step 1) and `__VERSION__` (literal `tauri-action` substitution token).
```
