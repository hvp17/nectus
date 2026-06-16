import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/testUtils";
import { ChatTranscript } from "./ChatTranscript";
import type { ChatMessage } from "../../types";

const messages: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "Fix the bug" }],
    createdAt: "t0",
    completedAt: "t0",
  },
  {
    id: "a1",
    role: "agent",
    parts: [
      { type: "reasoning", text: "Let me look at the file" },
      {
        type: "tool",
        toolCallId: "c1",
        title: "Read file",
        kind: "read",
        status: "completed",
        locations: [{ path: "src/main.rs", line: 12 }],
        output: "file contents here",
      },
      { type: "file_edit", path: "src/main.rs", additions: 3, deletions: 1, diff: "x" },
      { type: "text", text: "All done" },
    ],
    createdAt: "t1",
    completedAt: "t2",
  },
  {
    id: "p1",
    role: "agent",
    parts: [
      {
        type: "permission",
        requestId: "perm1",
        title: "Run rm -rf /tmp/x?",
        options: [
          { optionId: "allow", label: "Allow once", kind: "allow_once" },
          { optionId: "deny", label: "Deny", kind: "reject_once" },
        ],
      },
    ],
    createdAt: "t3",
  },
];

describe("ChatTranscript", () => {
  it("renders text, tool, file-edit, and permission parts", () => {
    renderWithProviders(<ChatTranscript messages={messages} />);

    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    expect(screen.getByText("All done")).toBeInTheDocument();
    expect(screen.getByText("Read file")).toBeInTheDocument();
    expect(screen.getByTestId("chat-tool-status")).toHaveTextContent("Completed");
    expect(screen.getByTestId("chat-file-chip")).toHaveTextContent("main.rs");
    expect(screen.getByText("Run rm -rf /tmp/x?")).toBeInTheDocument();
    // one row per message
    expect(screen.getAllByTestId("chat-message")).toHaveLength(3);
  });

  it("expands a tool card to reveal output", () => {
    renderWithProviders(<ChatTranscript messages={messages} />);
    expect(screen.queryByText("file contents here")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Read file"));
    expect(screen.getByText("file contents here")).toBeInTheDocument();
  });

  it("answers a permission request with the chosen option id", () => {
    const onRespondPermission = vi.fn();
    renderWithProviders(
      <ChatTranscript messages={messages} onRespondPermission={onRespondPermission} />,
    );
    fireEvent.click(screen.getByText("Allow once"));
    expect(onRespondPermission).toHaveBeenCalledWith("perm1", "allow");
  });

  it("opens a touched file from a file-edit chip", () => {
    const onOpenFile = vi.fn();
    renderWithProviders(<ChatTranscript messages={messages} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByTestId("chat-file-chip"));
    expect(onOpenFile).toHaveBeenCalledWith("src/main.rs");
  });
});
