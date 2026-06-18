import { describe, it, expect } from "vitest";
import { isSkillCall, skillCallName } from "./skillCall";
import type { ChatPart } from "@/types";

function toolPart(overrides: Partial<Extract<ChatPart, { type: "tool" }>>): ChatPart {
  return {
    type: "tool",
    toolCallId: "c1",
    title: "Skill",
    status: "completed",
    locations: [],
    ...overrides,
  };
}

describe("isSkillCall", () => {
  it("detects a tool call carrying a skill input", () => {
    const part = toolPart({
      title: "Skill",
      rawInput: { skill: "superpowers:brainstorming" },
    });
    expect(isSkillCall(part)).toBe(true);
  });

  it("detects a Skill-titled call before its input has streamed in", () => {
    const part = toolPart({ title: "Skill", rawInput: undefined });
    expect(isSkillCall(part)).toBe(true);
  });

  it("ignores ordinary tool calls", () => {
    const part = toolPart({ title: "Grep", kind: "search", rawInput: { pattern: "x" } });
    expect(isSkillCall(part)).toBe(false);
  });

  it("ignores non-tool parts", () => {
    const part: ChatPart = { type: "text", text: "hello" };
    expect(isSkillCall(part)).toBe(false);
  });
});

describe("skillCallName", () => {
  it("returns the skill id from rawInput", () => {
    const part = toolPart({ rawInput: { skill: "superpowers:brainstorming" } });
    expect(skillCallName(part as Extract<ChatPart, { type: "tool" }>)).toBe(
      "superpowers:brainstorming",
    );
  });

  it("returns an empty string when the skill id is not yet known", () => {
    const part = toolPart({ rawInput: undefined });
    expect(skillCallName(part as Extract<ChatPart, { type: "tool" }>)).toBe("");
  });
});
