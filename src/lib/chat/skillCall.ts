import type { ChatPart } from "@/types";

type ToolPart = Extract<ChatPart, { type: "tool" }>;

/** The skill id from a Skill tool call's rawInput ({ skill: "pkg:name" }), or null. */
function skillNameFromInput(rawInput: unknown): string | null {
  if (rawInput && typeof rawInput === "object" && "skill" in rawInput) {
    const skill = (rawInput as { skill: unknown }).skill;
    if (typeof skill === "string" && skill.trim()) return skill.trim();
  }
  return null;
}

/**
 * A tool part is a Skill call when it carries a `skill` input or is titled
 * "Skill" (the input may not have streamed in yet). Skill calls render as a
 * compact inline row, not the generic tool card.
 */
export function isSkillCall(part: ChatPart): boolean {
  return (
    part.type === "tool" &&
    (skillNameFromInput(part.rawInput) !== null || part.title.trim() === "Skill")
  );
}

/** The skill id for a Skill call (e.g. "superpowers:brainstorming"); "" if unknown. */
export function skillCallName(part: ToolPart): string {
  return skillNameFromInput(part.rawInput) ?? "";
}
