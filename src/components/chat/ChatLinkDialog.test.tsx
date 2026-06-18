import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/testUtils";
import { openExternal } from "../../lib/openExternal";
import { ChatLinkDialog } from "./ChatLinkDialog";

vi.mock("../../lib/openExternal", () => ({
  openExternal: vi.fn(),
}));

const mockedOpenExternal = vi.mocked(openExternal);

const url = "https://github.com/hvp17/nectus/pull/119";

describe("ChatLinkDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the link through the app opener plugin, never window.open", () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <ChatLinkDialog url={url} isOpen onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open link" }));

    expect(mockedOpenExternal).toHaveBeenCalledWith(url);
    // streamdown's default confirm (a no-op window.open inside the Tauri webview)
    // must not be used.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("copies the link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(
      <ChatLinkDialog url={url} isOpen onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("closes without opening when dismissed", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ChatLinkDialog url={url} isOpen onClose={onClose} onConfirm={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(mockedOpenExternal).not.toHaveBeenCalled();
  });
});
