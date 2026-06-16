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

  it("renders a command row with a success badge and the command", () => {
    const part: ChatPart = {
      type: "tool",
      toolCallId: "c1",
      title: "Ran command",
      kind: "execute",
      status: "completed",
      locations: [],
      rawInput: { command: "cargo test acp_cancel" },
      output: "test result: ok. 2 passed",
    };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0" })}</>);
    expect(screen.getByTestId("command-status-badge")).toHaveTextContent("Success");
    fireEvent.click(screen.getByTestId("chat-tool"));
    expect(screen.getByText(/cargo test acp_cancel/)).toBeInTheDocument();
  });

  it("renders an edit row with inline +/- stats and opens the diff on title click", () => {
    const part: ChatPart = {
      type: "file_edit",
      path: "src/lib.rs",
      additions: 4,
      deletions: 6,
      diff: "let x = 1;",
    };
    const onOpenFile = vi.fn();
    renderWithProviders(
      <>{renderChatPart({ part, partKey: "0", handlers: { onOpenFile } })}</>,
    );
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("-6")).toBeInTheDocument();
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

describe("ChatMessageRow grouping", () => {
  it("collapses a run of reads into one summary row", () => {
    const message: ChatMessage = {
      id: "m1",
      role: "agent",
      parts: [
        { type: "tool", toolCallId: "a", title: "Read", kind: "read", status: "completed", locations: [{ path: "a.rs" }], output: null },
        { type: "tool", toolCallId: "b", title: "Read", kind: "read", status: "completed", locations: [{ path: "b.rs" }], output: null },
        { type: "tool", toolCallId: "c", title: "Search", kind: "search", status: "completed", locations: [], output: null },
      ],
      createdAt: "t0",
      completedAt: "t1",
    };
    renderWithProviders(<ChatMessageRow message={message} />);
    expect(screen.getByTestId("chat-tool-group")).toBeInTheDocument();
    expect(screen.getByText("Read 2 files and searched code")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // count pill
  });
});
