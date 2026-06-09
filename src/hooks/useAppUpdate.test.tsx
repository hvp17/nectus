import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdate, type AppUpdateState } from "./useAppUpdate";
import type { DownloadProgress, InstallableUpdate, UpdateCheckResult } from "../lib/update";

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function holdInstallAfterProgress(progress: DownloadProgress): () => void {
  let finishInstall: (() => void) | undefined;
  lib.installUpdate.mockImplementation(async (_u: unknown, onProgress: (p: DownloadProgress) => void) => {
    onProgress(progress);
    await new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
  });
  return () => {
    if (!finishInstall) throw new Error("install did not start");
    finishInstall();
  };
}

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
    const finishInstall = holdInstallAfterProgress({ downloaded: 50, contentLength: 100 });
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    await act(async () => {
      void latest.installUpdate();
    });
    await waitFor(() => {
      expect(latest.status).toBe("downloading");
      expect(latest.progress).toBe(0.5);
    });
    await act(async () => {
      finishInstall();
    });
    await waitFor(() => expect(latest.status).toBe("ready"));
    expect(latest.progress).toBe(1);
    expect(lib.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps progress indeterminate when the download size is unknown", async () => {
    lib.checkForUpdate.mockResolvedValue(fakeResult());
    const finishInstall = holdInstallAfterProgress({ downloaded: 50, contentLength: null });
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));
    await act(async () => {
      void latest.installUpdate();
    });
    await waitFor(() => {
      expect(latest.status).toBe("downloading");
      expect(latest.progress).toBeNull();
    });
    await act(async () => {
      finishInstall();
    });
    await waitFor(() => expect(latest.status).toBe("ready"));
    expect(latest.progress).toBe(1);
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

  it("ignores an older check result after a newer check completes", async () => {
    const firstCheck = deferred<UpdateCheckResult | null>();
    const secondCheck = deferred<UpdateCheckResult | null>();
    lib.checkForUpdate.mockReturnValueOnce(firstCheck.promise).mockReturnValueOnce(secondCheck.promise);
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("checking"));

    let manualCheck!: Promise<void>;
    act(() => {
      manualCheck = latest.check();
    });
    await act(async () => {
      secondCheck.resolve(null);
      await manualCheck;
    });

    expect(latest.status).toBe("upToDate");
    expect(latest.info).toBeNull();

    await act(async () => {
      firstCheck.resolve(fakeResult());
      await firstCheck.promise;
      await Promise.resolve();
    });

    expect(latest.status).toBe("upToDate");
    expect(latest.info).toBeNull();
  });

  it("clears a previous pending update before a fresh check fails", async () => {
    lib.checkForUpdate.mockResolvedValueOnce(fakeResult()).mockRejectedValueOnce(new Error("network down"));
    render(<Probe />);
    await waitFor(() => expect(latest.status).toBe("available"));

    await act(async () => {
      await latest.check();
    });

    expect(latest.status).toBe("error");
    expect(latest.info).toBeNull();

    await act(async () => {
      await latest.installUpdate();
    });

    expect(lib.installUpdate).not.toHaveBeenCalled();
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
