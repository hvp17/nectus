import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithTooltipProvider } from "../../test/testUtils";
import { openExternal } from "../../lib/openExternal";
import type { JiraRestStatus } from "../../types";
import { JiraConnectionCard } from "./JiraConnectionCard";

vi.mock("../../lib/openExternal", () => ({ openExternal: vi.fn() }));

const connected: JiraRestStatus = {
  connected: true,
  site: "team.atlassian.net",
  email: "me@example.com",
  error: null,
};

describe("JiraConnectionCard", () => {
  it("saves the entered site, email, and token", async () => {
    const onSave = vi.fn(async () => connected);
    renderWithTooltipProvider(
      <JiraConnectionCard
        busy={false}
        onSave={onSave}
        onDisconnect={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText("Site"), { target: { value: "team.atlassian.net" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Test & connect" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("team.atlassian.net", "me@example.com", "secret-token"),
    );
  });

  it("deep-links to the Atlassian API-token page", () => {
    renderWithTooltipProvider(
      <JiraConnectionCard
        busy={false}
        onSave={vi.fn(async () => connected)}
        onDisconnect={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Create a token/ }));

    expect(vi.mocked(openExternal)).toHaveBeenCalledWith(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
    );
  });

  it("disconnects when connected", async () => {
    const onDisconnect = vi.fn(async () => {});
    renderWithTooltipProvider(
      <JiraConnectionCard
        status={connected}
        busy={false}
        onSave={vi.fn(async () => connected)}
        onDisconnect={onDisconnect}
      />,
    );

    expect(screen.getByLabelText("JIRA REST Connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
  });

  it("surfaces a disconnect failure inline instead of swallowing it", async () => {
    const onDisconnect = vi.fn(async () => {
      throw new Error("Keychain locked");
    });
    renderWithTooltipProvider(
      <JiraConnectionCard
        status={connected}
        busy={false}
        onSave={vi.fn(async () => connected)}
        onDisconnect={onDisconnect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText(/Keychain locked/)).toBeInTheDocument();
  });
});
