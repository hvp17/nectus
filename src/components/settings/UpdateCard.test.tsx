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
