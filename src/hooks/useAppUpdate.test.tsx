import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdate, type AppUpdateState } from "./useAppUpdate";
import type { InstallableUpdate, UpdateCheckResult } from "../lib/update";

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

let latest!: AppUpdateState;
function Probe() {
  latest = useAppUpdate();
  return null;
}

const fakeResult = (): UpdateCheckResult => ({
  update: { downloadAndInstall: vi.fn() } satisfies InstallableUpdate,
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

  it("runs a launch check and resolves to upToDate", async () => {
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
    let finishInstall: (() => void) | undefined;
    lib.installUpdate.mockImplementation(
      async (_u: unknown, onProgress: (p: { downloaded: number; contentLength: number | null }) => void) => {
        onProgress({ downloaded: 50, contentLength: 100 });
        await new Promise<void>((resolve) => {
          finishInstall = resolve;
        });
      },
    );
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    await act(async () => {
      void latest.installUpdate();
    });
    await waitFor(() => {
      expect(latest.status).toBe("downloading");
      expect(latest.progress).toBe(0.5);
      expect(finishInstall).toBeDefined();
    });
    await act(async () => {
      finishInstall?.();
    });
    await waitFor(() => expect(latest.status).toBe("ready"));
    expect(latest.progress).toBe(1);
    expect(lib.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores a second install while one is in flight", async () => {
    lib.checkForUpdate.mockResolvedValue(fakeResult());
    let resolveInstall: () => void = () => {};
    lib.installUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    await act(async () => {
      const first = latest.installUpdate();
      const second = latest.installUpdate();
      resolveInstall();
      await Promise.all([first, second]);
    });
    expect(lib.installUpdate).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("ready");
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
