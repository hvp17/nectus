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

  it("shows a command's path args relative to the session cwd", () => {
    const cwd = "/Users/tomas/.nectus/worktrees/nectus/task-1";
    const part: ChatPart = {
      type: "tool",
      toolCallId: "c1",
      title: "Ran command",
      kind: "execute",
      status: "completed",
      locations: [],
      rawInput: { command: `find ${cwd}/src/lib/chat -type f` },
      output: "ok",
    };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0", handlers: { cwd } })}</>);
    expect(screen.getByText(/Ran find src\/lib\/chat -type f/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(cwd))).not.toBeInTheDocument();
  });

  it("shows a read tool's location relative to the session cwd", () => {
    const cwd = "/Users/tomas/.nectus/worktrees/nectus/task-1";
    const part: ChatPart = {
      type: "tool",
      toolCallId: "c2",
      title: "Read",
      kind: "read",
      status: "completed",
      locations: [{ path: `${cwd}/src/types.ts`, line: 12 }],
      output: null,
    };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0", handlers: { cwd } })}</>);
    fireEvent.click(screen.getByRole("button")); // expand the tool body
    expect(screen.getByText("src/types.ts:12")).toBeInTheDocument();
  });

  it("renders a skill call as a compact inline row, not the tool card", () => {
    const part: ChatPart = {
      type: "tool",
      toolCallId: "s1",
      title: "Skill",
      status: "completed",
      locations: [],
      rawInput: { skill: "superpowers:brainstorming" },
      output: "Launching skill: superpowers:brainstorming",
    };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0" })}</>);
    const row = screen.getByTestId("chat-skill-call");
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute("data-status", "completed");
    expect(screen.getByText("superpowers:brainstorming")).toBeInTheDocument();
    // No generic tool card / PARAMETERS / RESULT sections for a skill call.
    expect(screen.queryByTestId("chat-tool")).not.toBeInTheDocument();
    expect(screen.queryByText(/Parameters/i)).not.toBeInTheDocument();
  });

  it("shimmers a running skill call and settles to static text when completed", () => {
    const running: ChatPart = {
      type: "tool",
      toolCallId: "s2",
      title: "Skill",
      status: "running",
      locations: [],
      rawInput: { skill: "superpowers:brainstorming" },
      output: null,
    };
    const { rerender } = renderWithProviders(
      <>{renderChatPart({ part: running, partKey: "0" })}</>,
    );
    expect(screen.getByTestId("chat-skill-shimmer")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-skill-label")).not.toBeInTheDocument();

    const completed: ChatPart = { ...running, status: "completed", output: "done" };
    rerender(<>{renderChatPart({ part: completed, partKey: "0" })}</>);
    expect(screen.queryByTestId("chat-skill-shimmer")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-skill-label")).toBeInTheDocument();
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

  it("shows grouped read rows relative to the session cwd", () => {
    const cwd = "/Users/tomas/.nectus/worktrees/nectus/task-1";
    const message: ChatMessage = {
      id: "m1",
      role: "agent",
      parts: [
        { type: "tool", toolCallId: "a", title: "Read", kind: "read", status: "completed", locations: [{ path: `${cwd}/src/a.rs` }], output: null },
        { type: "tool", toolCallId: "b", title: "Read", kind: "read", status: "completed", locations: [{ path: `${cwd}/src/b.rs` }], output: null },
      ],
      createdAt: "t0",
      completedAt: "t1",
    };
    renderWithProviders(<ChatMessageRow handlers={{ cwd }} message={message} />);
    fireEvent.click(screen.getByText("Read 2 files")); // expand the group body
    expect(screen.getByText("src/a.rs")).toBeInTheDocument();
    expect(screen.getByText("src/b.rs")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(cwd))).not.toBeInTheDocument();
  });
});
