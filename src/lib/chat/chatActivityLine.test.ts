import { describe, expect, it } from "vitest";
import { chatActivityLine, chatPermissionAttention, isChatAgentWorking } from "./chatActivityLine";
import type { ChatMessage } from "@/types";

function agentMessage(parts: ChatMessage["parts"], completedAt: string | null = null): ChatMessage {
  return {
    id: "m-1",
    role: "agent",
    parts,
    createdAt: "2026-06-15T00:00:00.000Z",
    completedAt,
  };
}

describe("chatActivityLine", () => {
  it("prefers the latest meaningful part", () => {
    const line = chatActivityLine(
      agentMessage([
        { type: "reasoning", text: "hmm" },
        { type: "tool", toolCallId: "t1", title: "Read file", status: "running", locations: [] },
      ]),
    );
    expect(line).toBe("Read file");
  });

  it("surfaces permission titles for triage", () => {
    const attention = chatPermissionAttention(
      agentMessage([
        {
          type: "permission",
          requestId: "p1",
          title: "Run shell command",
          options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
        },
      ]),
    );
    expect(attention?.title).toBe("Run shell command");
  });
});

describe("isChatAgentWorking", () => {
  it("is true while an agent turn is still streaming", () => {
    expect(isChatAgentWorking([agentMessage([{ type: "text", text: "…" }])])).toBe(true);
    expect(isChatAgentWorking([agentMessage([{ type: "text", text: "done" }], "2026-06-15T00:01:00.000Z")])).toBe(
      false,
    );
  });
});
