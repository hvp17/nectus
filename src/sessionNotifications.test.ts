import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { notifySessionEvent } from "./sessionNotifications";

vi.mock("./api", () => ({
  api: {
    sendSystemNotification: vi.fn().mockResolvedValue(true),
  },
}));

const mockedApi = vi.mocked(api);

describe("notifySessionEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.sendSystemNotification.mockResolvedValue(true);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes raw session notification bodies to the API boundary", async () => {
    await notifySessionEvent("Codex finished", "A".repeat(300));

    expect(mockedApi.sendSystemNotification).toHaveBeenCalledWith("Codex finished", "A".repeat(300));
  });

  it("does not send outside the Tauri runtime", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

    await notifySessionEvent("Codex finished", "Done");

    expect(mockedApi.sendSystemNotification).not.toHaveBeenCalled();
  });

  it("warns when notification permission is not granted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedApi.sendSystemNotification.mockResolvedValueOnce(false);

    await notifySessionEvent("Codex needs input", "Waiting on approval");

    expect(warn).toHaveBeenCalledWith("Notification permission not granted");
  });

  it("logs a failed notification send", async () => {
    const error = new Error("notification failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedApi.sendSystemNotification.mockRejectedValueOnce(error);

    await notifySessionEvent("Codex finished", "Done");

    expect(consoleError).toHaveBeenCalledWith("Failed to send session notification", error);
  });
});
