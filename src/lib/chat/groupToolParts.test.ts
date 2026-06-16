import { describe, it, expect } from "vitest";
import { groupToolParts, groupToolSummary, groupToolStatus, type ToolPart } from "./groupToolParts";
import type { ChatPart } from "@/types";

const tool = (over: Partial<ToolPart>): ToolPart => ({
  type: "tool",
  toolCallId: over.toolCallId ?? "t",
  title: over.title ?? "Read file",
  kind: over.kind ?? "read",
  status: over.status ?? "completed",
  locations: over.locations ?? [],
  rawInput: over.rawInput,
  output: over.output ?? null,
});
const text = (t: string): ChatPart => ({ type: "text", text: t });

describe("groupToolParts", () => {
  it("returns singles unchanged when nothing is groupable", () => {
    const parts = [text("hi"), tool({ kind: "execute", title: "Ran ls" })];
    const items = groupToolParts(parts);
    expect(items.map((i) => i.kind)).toEqual(["single", "single"]);
  });

  it("groups a run of >= 2 adjacent read/search/fetch parts", () => {
    const parts = [
      tool({ toolCallId: "a", kind: "read" }),
      tool({ toolCallId: "b", kind: "search" }),
      tool({ toolCallId: "c", kind: "fetch" }),
    ];
    const items = groupToolParts(parts);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool-group");
    if (items[0].kind === "tool-group") expect(items[0].parts).toHaveLength(3);
  });

  it("does NOT group a run of length 1", () => {
    const parts = [tool({ kind: "read" }), text("x"), tool({ kind: "read" })];
    expect(groupToolParts(parts).map((i) => i.kind)).toEqual([
      "single",
      "single",
      "single",
    ]);
  });

  it("breaks runs on any non-groupable part, preserving order", () => {
    const parts = [
      tool({ toolCallId: "a", kind: "read" }),
      tool({ toolCallId: "b", kind: "read" }),
      tool({ toolCallId: "x", kind: "execute" }),
      tool({ toolCallId: "c", kind: "search" }),
      tool({ toolCallId: "d", kind: "search" }),
    ];
    expect(groupToolParts(parts).map((i) => i.kind)).toEqual([
      "tool-group",
      "single",
      "tool-group",
    ]);
  });

  it("summarizes reads-only, search-only, and mixed runs", () => {
    expect(groupToolSummary([tool({ kind: "read" }), tool({ kind: "read" })])).toEqual({
      title: "Read 2 files",
      count: 2,
    });
    expect(groupToolSummary([tool({ kind: "search" }), tool({ kind: "search" })])).toEqual({
      title: "Searched code",
      count: 2,
    });
    expect(
      groupToolSummary([tool({ kind: "read" }), tool({ kind: "search" })]),
    ).toEqual({ title: "Read 1 file and searched code", count: 2 });
  });

  it("derives the worst group status", () => {
    expect(groupToolStatus([tool({ status: "completed" }), tool({ status: "completed" })])).toBe(
      "completed",
    );
    expect(groupToolStatus([tool({ status: "completed" }), tool({ status: "running" })])).toBe(
      "running",
    );
    expect(groupToolStatus([tool({ status: "running" }), tool({ status: "failed" })])).toBe(
      "failed",
    );
  });
});
