import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "../components/ui/sonner";
import type { TaskToast } from "../taskNotification";
import { useTaskNotificationToast } from "./useTaskNotificationToast";

afterEach(() => {
  vi.useRealTimers();
});

function Harness({
  notification,
  onOpenTask,
  onShown,
}: {
  notification: TaskToast | null;
  onOpenTask: (taskId: number) => void;
  onShown: () => void;
}) {
  useTaskNotificationToast({ notification, onOpenTask, onShown });
  return <Toaster />;
}

const finished: TaskToast = {
  taskId: 42,
  title: "Claude finished",
  body: "Wire up auth",
  kind: "success",
};

describe("useTaskNotificationToast", () => {
  it("renders a toast carrying the notification text", async () => {
    render(<Harness notification={finished} onOpenTask={vi.fn()} onShown={vi.fn()} />);

    const body = await screen.findByText("Wire up auth");
    expect(body.closest("[data-sonner-toast]")).toBeInTheDocument();
  });

  it("opens the linked task when the action is clicked", async () => {
    const onOpenTask = vi.fn();
    render(<Harness notification={finished} onOpenTask={onOpenTask} onShown={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /open task/i }));

    expect(onOpenTask).toHaveBeenCalledWith(42);
  });

  it("clears the notification after showing it so it fires once", async () => {
    const onShown = vi.fn();
    render(<Harness notification={finished} onOpenTask={vi.fn()} onShown={onShown} />);

    await waitFor(() => expect(onShown).toHaveBeenCalledTimes(1));
  });

  it("shows nothing when there is no notification", () => {
    render(<Harness notification={null} onOpenTask={vi.fn()} onShown={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /open task/i })).not.toBeInTheDocument();
  });
});
