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
  type InstallableUpdate,
  installUpdate,
  isUpdaterAvailable,
  relaunchApp,
} from "./update";

function setTauri(present: boolean) {
  const win = window as unknown as Record<string, unknown>;
  if (present) win.__TAURI_INTERNALS__ = {};
  else delete win.__TAURI_INTERNALS__;
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
    const update = { downloadAndInstall } satisfies InstallableUpdate;
    await installUpdate(update, (p) => progress.push(p));
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
