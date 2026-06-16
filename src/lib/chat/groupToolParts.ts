import type { ChatPart, ChatToolStatus } from "@/types";

export type ToolPart = Extract<ChatPart, { type: "tool" }>;

/** A read/search/fetch tool part may be folded into a summary group. */
const GROUPABLE_KINDS = new Set(["read", "search", "fetch"]);

export function isGroupable(part: ChatPart): part is ToolPart {
  return part.type === "tool" && part.kind != null && GROUPABLE_KINDS.has(part.kind);
}

export type RenderItem =
  | { kind: "single"; key: string; part: ChatPart; index: number }
  | { kind: "tool-group"; key: string; parts: ToolPart[] };

/**
 * Fold a message's parts into a render list. A maximal run of >= 2 adjacent
 * read/search/fetch tool parts becomes one `tool-group`; everything else (incl.
 * a run of length 1) passes through as a `single`, preserving transcript order.
 */
export function groupToolParts(parts: ChatPart[]): RenderItem[] {
  const items: RenderItem[] = [];
  let run: { part: ToolPart; index: number }[] = [];

  const flush = () => {
    if (run.length >= 2) {
      items.push({
        kind: "tool-group",
        key: `g-${run[0].index}`,
        parts: run.map((r) => r.part),
      });
    } else {
      for (const r of run) {
        items.push({ kind: "single", key: String(r.index), part: r.part, index: r.index });
      }
    }
    run = [];
  };

  parts.forEach((part, index) => {
    if (isGroupable(part)) {
      run.push({ part, index });
      return;
    }
    flush();
    items.push({ kind: "single", key: String(index), part, index });
  });
  flush();
  return items;
}

export function groupToolSummary(parts: ToolPart[]): { title: string; count: number } {
  const reads = parts.filter((p) => p.kind === "read" || p.kind === "fetch").length;
  const searches = parts.filter((p) => p.kind === "search").length;
  const fileWord = reads === 1 ? "file" : "files";
  let title: string;
  if (searches === 0) title = `Read ${reads} ${fileWord}`;
  else if (reads === 0) title = "Searched code";
  else title = `Read ${reads} ${fileWord} and searched code`;
  return { title, count: parts.length };
}

export function groupToolStatus(parts: ToolPart[]): ChatToolStatus {
  if (parts.some((p) => p.status === "failed")) return "failed";
  if (parts.some((p) => p.status === "pending" || p.status === "running")) return "running";
  return "completed";
}
