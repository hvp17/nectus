import type { TaskAttention } from "../sessionAttention";

export const FINISHED_ATTENTION_PREVIEW_LIMIT = 180;

export function truncateFinishedAttentionPreview(content: string) {
  if (content.length <= FINISHED_ATTENTION_PREVIEW_LIMIT) return content;
  return `${content.slice(0, FINISHED_ATTENTION_PREVIEW_LIMIT).trimEnd()}...`;
}

export interface AttentionPreview {
  /** The raw attention detail (prompt for needs-input, message for idle). */
  detail: string | null | undefined;
  /** The detail as shown — an idle detail is truncated to the preview limit. */
  displayed: string | null | undefined;
  /** Whether `displayed` was shortened from `detail`. */
  truncated: boolean;
}

/**
 * Derive the attention preview shown on a task card and in the workspace: the
 * needs-input prompt or idle message, with an over-long idle message truncated.
 * Shared so the two surfaces can't drift.
 */
export function deriveAttentionPreview(attention: TaskAttention | undefined): AttentionPreview {
  const detail = attention?.prompt ?? attention?.message;
  const displayed =
    attention?.kind === "idle" && detail ? truncateFinishedAttentionPreview(detail) : detail;
  const truncated = Boolean(detail && displayed && displayed !== detail);
  return { detail, displayed, truncated };
}
