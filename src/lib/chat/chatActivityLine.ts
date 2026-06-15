import type { ChatMessage, ChatPart } from "@/types";

/** Latest human-readable activity for the left rail / Mission Control. */
export function chatActivityLine(message: ChatMessage): string | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const line = partActivityLine(message.parts[index]);
    if (line) return line;
  }
  return null;
}

function partActivityLine(part: ChatPart): string | null {
  switch (part.type) {
    case "text": {
      const trimmed = part.text.trim();
      return trimmed ? truncate(trimmed) : null;
    }
    case "reasoning":
      return "Thinking…";
    case "tool":
      return part.title.trim() || "Running tool…";
    case "file_edit":
      return `Edited ${part.path}`;
    case "permission":
      return part.title.trim() || "Permission required";
    case "plan":
      return "Planning…";
    default:
      return null;
  }
}

function truncate(line: string, max = 120): string {
  const oneLine = line.replace(/\s+/g, " ");
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** True while an agent turn is still streaming (excludes permission-only rows). */
export function isChatAgentWorking(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "agent" &&
      message.completedAt == null &&
      !message.id.startsWith("perm-"),
  );
}

/** Pending permission that should surface in triage as needs-you. */
export function chatPermissionAttention(message: ChatMessage): { title: string; prompt: string } | null {
  if (message.role !== "agent" || message.completedAt != null) return null;
  const permission = message.parts.find((part) => part.type === "permission");
  if (!permission || permission.type !== "permission") return null;
  return {
    title: permission.title,
    prompt: permission.options.map((option) => option.label).join(" · "),
  };
}
