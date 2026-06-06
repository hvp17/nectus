import { describe, expect, it } from "vitest";
import { isCliConnected } from "./connection";

describe("isCliConnected", () => {
  it("is true only when installed and authenticated", () => {
    expect(isCliConnected({ installed: true, authenticated: true })).toBe(true);
  });

  it("is false when not installed or not authenticated", () => {
    expect(isCliConnected({ installed: false, authenticated: true })).toBe(false);
    expect(isCliConnected({ installed: true, authenticated: false })).toBe(false);
  });

  it("is false for a missing status", () => {
    expect(isCliConnected(null)).toBe(false);
    expect(isCliConnected(undefined)).toBe(false);
  });
});
