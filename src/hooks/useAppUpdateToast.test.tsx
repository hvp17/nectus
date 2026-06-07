import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "../components/ui/sonner";
import { useAppUpdateToast } from "./useAppUpdateToast";
import type { UpdateStatus } from "./useAppUpdate";
import type { UpdateInfo } from "../lib/update";

const info: UpdateInfo = { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null };

function Harness(props: {
  status: UpdateStatus;
  info: UpdateInfo | null;
  onInstall: () => void;
  onRelaunch: () => void;
}) {
  useAppUpdateToast(props);
  return <Toaster />;
}

describe("useAppUpdateToast", () => {
  it("shows an Install toast when an update is available", async () => {
    const onInstall = vi.fn();
    render(<Harness status="available" info={info} onInstall={onInstall} onRelaunch={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /install/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("shows a Relaunch toast when the update is ready", async () => {
    const onRelaunch = vi.fn();
    render(<Harness status="ready" info={info} onInstall={vi.fn()} onRelaunch={onRelaunch} />);
    fireEvent.click(await screen.findByRole("button", { name: /relaunch/i }));
    expect(onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("shows nothing while up to date", () => {
    render(<Harness status="upToDate" info={null} onInstall={vi.fn()} onRelaunch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /relaunch/i })).not.toBeInTheDocument();
  });
});
