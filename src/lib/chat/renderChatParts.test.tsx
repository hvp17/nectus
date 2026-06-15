import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/testUtils";
import {
  ChatMessageRow,
  mapToolState,
  renderChatPart,
} from "./renderChatParts";
import type { ChatMessage, ChatPart } from "@/types";

describe("mapToolState", () => {
  it("maps ACP tool statuses to AI Elements tool states", () => {
    expect(mapToolState("pending")).toBe("input-streaming");
    expect(mapToolState("running")).toBe("input-available");
    expect(mapToolState("completed")).toBe("output-available");
    expect(mapToolState("failed")).toBe("output-error");
  });
});

describe("renderChatPart", () => {
  it("renders text parts with chat-text test id", () => {
    const part: ChatPart = { type: "text", text: "Hello **world**" };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0" })}</>);
    expect(screen.getByTestId("chat-text")).toBeInTheDocument();
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
  });

  it("renders permission actions", () => {
    const part: ChatPart = {
      type: "permission",
      requestId: "req-1",
      title: "Allow shell?",
      options: [
        { optionId: "allow", label: "Allow", kind: "allow_once" },
        { optionId: "deny", label: "Deny", kind: "reject_once" },
      ],
    };
    const onRespondPermission = vi.fn();
    renderWithProviders(
      <>{renderChatPart({ part, partKey: "0", handlers: { onRespondPermission } })}</>,
    );
    fireEvent.click(screen.getByText("Allow"));
    expect(onRespondPermission).toHaveBeenCalledWith("req-1", "allow");
  });

  it("renders file edit chips", () => {
    const part: ChatPart = {
      type: "file_edit",
      path: "src/lib.rs",
      additions: 2,
      deletions: 1,
      diff: null,
    };
    const onOpenFile = vi.fn();
    renderWithProviders(
      <>{renderChatPart({ part, partKey: "0", handlers: { onOpenFile } })}</>,
    );
    fireEvent.click(screen.getByTestId("chat-file-chip"));
    expect(onOpenFile).toHaveBeenCalledWith("src/lib.rs");
  });
});

describe("ChatMessageRow", () => {
  const message: ChatMessage = {
    id: "m1",
    role: "agent",
    parts: [
      {
        type: "tool",
        toolCallId: "t1",
        title: "Grep",
        status: "completed",
        locations: [],
        output: "matches",
      },
    ],
    createdAt: "t0",
    completedAt: "t1",
  };

  it("wraps parts in a message row", () => {
    renderWithProviders(<ChatMessageRow message={message} />);
    expect(screen.getByTestId("chat-message")).toHaveAttribute("data-role", "agent");
    expect(screen.getByText("Grep")).toBeInTheDocument();
  });
});
