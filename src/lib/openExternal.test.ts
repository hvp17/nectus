import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "../api";
import { openExternal } from "./openExternal";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  api: {
    openExternalUrl: vi.fn(),
  },
}));

const mockedOpenExternalUrl = vi.mocked(api.openExternalUrl);
const mockedToastError = vi.mocked(toast.error);

describe("openExternal", () => {
  beforeEach(() => {
    mockedOpenExternalUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("delegates external URLs to the app API", () => {
    openExternal("https://example.com/docs");

    expect(mockedOpenExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(mockedToastError).not.toHaveBeenCalled();
  });

  it("surfaces opener failures without throwing synchronously", async () => {
    const error = new Error("opener denied");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedOpenExternalUrl.mockRejectedValueOnce(error);

    expect(() => openExternal("https://example.com/pr/1")).not.toThrow();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to open external URL",
      "https://example.com/pr/1",
      error,
    );
    expect(mockedToastError).toHaveBeenCalledWith("Couldn't open link", {
      description: "Opening the link in your browser failed.",
    });
  });
});
