import { describe, expect, it } from "vitest";
import {
  deriveAttentionPreview,
  FINISHED_ATTENTION_PREVIEW_LIMIT,
  truncateFinishedAttentionPreview,
} from "./attentionPreview";
import type { TaskAttention } from "../sessionAttention";

function attention(overrides: Partial<TaskAttention>): TaskAttention {
  return {
    taskId: 1,
    kind: "needs_input",
    title: "A task",
    updatedAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("truncateFinishedAttentionPreview", () => {
  it("leaves short content untouched", () => {
    expect(truncateFinishedAttentionPreview("short")).toBe("short");
  });

  it("truncates over-long content with an ellipsis", () => {
    const long = "x".repeat(FINISHED_ATTENTION_PREVIEW_LIMIT + 10);
    const result = truncateFinishedAttentionPreview(long);
    expect(result.endsWith("...")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(FINISHED_ATTENTION_PREVIEW_LIMIT + 3);
  });
});

describe("deriveAttentionPreview", () => {
  it("uses the prompt for a needs-input attention and does not truncate", () => {
    const preview = deriveAttentionPreview(attention({ kind: "needs_input", prompt: "Approve?" }));
    expect(preview.detail).toBe("Approve?");
    expect(preview.displayed).toBe("Approve?");
    expect(preview.truncated).toBe(false);
  });

  it("truncates a long idle message and flags it", () => {
    const message = "y".repeat(FINISHED_ATTENTION_PREVIEW_LIMIT + 20);
    const preview = deriveAttentionPreview(attention({ kind: "idle", prompt: null, message }));
    expect(preview.truncated).toBe(true);
    expect(preview.displayed?.endsWith("...")).toBe(true);
  });

  it("returns empty preview for no attention", () => {
    const preview = deriveAttentionPreview(undefined);
    expect(preview.detail).toBeUndefined();
    expect(preview.displayed).toBeUndefined();
    expect(preview.truncated).toBe(false);
  });
});
