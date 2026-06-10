import { describe, expect, it } from "vitest";
import { groupByEpic } from "./jiraSprints";
import type { JiraWorkItem } from "../types";

function item(key: string, epicKey?: string, epicName?: string): JiraWorkItem {
  return {
    key,
    summary: key,
    statusName: "To Do",
    statusCategory: "to_do",
    epicKey: epicKey ?? null,
    epicName: epicName ?? null,
  };
}

describe("groupByEpic", () => {
  it("groups by epic in first-seen order with 'no epic' last", () => {
    const groups = groupByEpic([
      item("A-1", "E-1", "Checkout"),
      item("A-2"),
      item("A-3", "E-2", "Billing"),
      item("A-4", "E-1", "Checkout"),
    ]);

    expect(groups.map((g) => g.epicKey)).toEqual(["E-1", "E-2", null]);
    expect(groups[0].items.map((i) => i.key)).toEqual(["A-1", "A-4"]);
    expect(groups[2].epicName).toBeNull();
    expect(groups[2].items.map((i) => i.key)).toEqual(["A-2"]);
  });

  it("backfills an epic name from a later issue when the first lacks it", () => {
    const groups = groupByEpic([item("A-1", "E-1"), item("A-2", "E-1", "Checkout")]);
    expect(groups[0].epicName).toBe("Checkout");
  });

  it("returns an empty array for no items", () => {
    expect(groupByEpic([])).toEqual([]);
  });
});
