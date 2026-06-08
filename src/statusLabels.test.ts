import { describe, expect, it } from "vitest";
import { isReviewLoopActive, prReviewVerdictKey } from "./statusLabels";

describe("isReviewLoopActive", () => {
  it("is true while the loop is running or reviewing", () => {
    expect(isReviewLoopActive("running")).toBe(true);
    expect(isReviewLoopActive("reviewing")).toBe(true);
  });

  it("is false once the loop reaches a terminal status", () => {
    expect(isReviewLoopActive("passed")).toBe(false);
    expect(isReviewLoopActive("feedback_sent")).toBe(false);
    expect(isReviewLoopActive("error")).toBe(false);
    expect(isReviewLoopActive("stopped")).toBe(false);
  });
});

describe("prReviewVerdictKey", () => {
  it("keeps the concrete verdicts as-is", () => {
    expect(prReviewVerdictKey("passed")).toBe("passed");
    expect(prReviewVerdictKey("blockers")).toBe("blockers");
    expect(prReviewVerdictKey("inconclusive")).toBe("inconclusive");
  });

  it("falls back to inconclusive for a missing verdict", () => {
    expect(prReviewVerdictKey(null)).toBe("inconclusive");
    expect(prReviewVerdictKey(undefined)).toBe("inconclusive");
  });
});
