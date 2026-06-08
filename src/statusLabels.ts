import type { PrReviewVerdict, ReviewLoopStatus, ReviewVerdict, TaskStatus } from "./types";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

/** Verbose labels for board cards, where the review badge stands on its own. */
export const REVIEW_LOOP_STATUS_LABELS: Record<ReviewLoopStatus, string> = {
  running: "Review ready",
  reviewing: "Reviewing",
  passed: "Review passed",
  feedback_sent: "Review feedback",
  error: "Review error",
  stopped: "Review stopped",
};

/** Short labels for the task workspace, where surrounding copy already says "Review". */
export const REVIEW_LOOP_STATUS_SHORT_LABELS: Record<ReviewLoopStatus, string> = {
  running: "Ready",
  reviewing: "Reviewing",
  passed: "Passed",
  feedback_sent: "Feedback sent",
  error: "Error",
  stopped: "Stopped",
};

export const REVIEW_LOOP_BADGE_VARIANTS: Record<ReviewLoopStatus, BadgeVariant> = {
  running: "secondary",
  reviewing: "default",
  passed: "secondary",
  feedback_sent: "destructive",
  error: "destructive",
  stopped: "outline",
};

/** Review-loop statuses that mean the loop has finished (no longer running). */
export const REVIEW_TERMINAL_STATUSES: ReviewLoopStatus[] = [
  "passed",
  "feedback_sent",
  "error",
  "stopped",
];

/** True while a review loop is still in flight (running or reviewing). */
export function isReviewLoopActive(status: ReviewLoopStatus): boolean {
  return !REVIEW_TERMINAL_STATUSES.includes(status);
}

export const REVIEW_VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "Pass",
  needs_changes: "Needs changes",
  feedback: "Feedback",
  unknown: "Unknown",
};

/**
 * Short (dense consensus-matrix cell) and long (badge / banner) labels for a
 * finished PR-review verdict. The verdict value doubles as its CSS/tone token
 * (`data-v` / `data-pr-verdict-tone`), so callers style off the verdict directly.
 */
export const PR_REVIEW_VERDICT_LABELS: Record<PrReviewVerdict, { short: string; long: string }> = {
  passed: { short: "Passed", long: "Passed" },
  blockers: { short: "Blocking", long: "Blocking issues" },
  inconclusive: { short: "Unsure", long: "Inconclusive" },
};

/** Normalize a possibly-null verdict to a display key (null/unknown → inconclusive). */
export function prReviewVerdictKey(verdict: PrReviewVerdict | null | undefined): PrReviewVerdict {
  return verdict === "passed" || verdict === "blockers" ? verdict : "inconclusive";
}
