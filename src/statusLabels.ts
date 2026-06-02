import type { ReviewLoopStatus, ReviewVerdict, TaskStatus } from "./types";

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

export const REVIEW_VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "Pass",
  needs_changes: "Needs changes",
  feedback: "Feedback",
  unknown: "Unknown",
};
