import { beforeEach, describe, expect, it, vi } from "vitest";
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
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("truncates long session notification bodies before sending", async () => {
    await notifySessionEvent("Codex finished", "A".repeat(300));

    expect(mockedApi.sendSystemNotification).toHaveBeenCalledWith("Codex finished", `${"A".repeat(177)}...`);
  });
});
