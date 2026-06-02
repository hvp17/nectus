import { describe, expect, it } from "vitest";
import { replaceById, upsertById } from "./listState";

interface Item {
  id: number;
  name: string;
}

const a: Item = { id: 1, name: "a" };
const b: Item = { id: 2, name: "b" };

describe("replaceById", () => {
  it("replaces the matching item", () => {
    expect(replaceById([a, b], { id: 2, name: "B" })).toEqual([a, { id: 2, name: "B" }]);
  });

  it("leaves the list unchanged when no id matches", () => {
    expect(replaceById([a, b], { id: 99, name: "x" })).toEqual([a, b]);
  });
});

describe("upsertById", () => {
  it("replaces an existing item", () => {
    expect(upsertById([a, b], { id: 1, name: "A" })).toEqual([{ id: 1, name: "A" }, b]);
  });

  it("appends a new item", () => {
    const c: Item = { id: 3, name: "c" };
    expect(upsertById([a, b], c)).toEqual([a, b, c]);
  });
});
