import { describe, expect, it } from "vitest";
import { parseReviewCommand } from "./reviewCommand";

describe("parseReviewCommand", () => {
  it("matches bare /review with no focus", () => {
    expect(parseReviewCommand("/review")).toEqual({ isReview: true, focus: undefined });
    expect(parseReviewCommand("  /review  ")).toEqual({ isReview: true, focus: undefined });
  });
  it("captures a focus argument", () => {
    expect(parseReviewCommand("/review check the locking")).toEqual({
      isReview: true,
      focus: "check the locking",
    });
  });
  it("does not match /review embedded mid-message", () => {
    expect(parseReviewCommand("please /review this")).toEqual({ isReview: false });
    expect(parseReviewCommand("/reviewer")).toEqual({ isReview: false });
  });
});
