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

let latest!: AppUpdateState;
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
    lib.installUpdate.mockImplementation(
      async (_u: unknown, onProgress: (p: { downloaded: number; contentLength: number | null }) => void) => {
        onProgress({ downloaded: 50, contentLength: 100 });
      },
    );
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
