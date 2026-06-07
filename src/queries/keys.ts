/**
 * Central catalog of TanStack Query keys.
 *
 * One module owns every key so cache reads/writes (including the Tauri event
 * bridge in the session hooks) reference the same tuples and never drift. Keys are
 * hierarchical so a domain can be invalidated wholesale (e.g. all `["github", …]`).
 *
 * Only the keys for queries actually wired to TanStack Query live here. The
 * remaining per-domain hooks (JIRA board, task diff, review loop, PR reviews) still
 * load through their own state; converting them adds their keys here.
 */
export const queryKeys = {
  repos: () => ["repos"] as const,
  workspaces: () => ["workspaces"] as const,
  tasks: () => ["tasks"] as const,
  agentProfiles: () => ["agent-profiles"] as const,
  settings: () => ["settings"] as const,

  github: {
    status: () => ["github", "status"] as const,
    /** Live PR status for one task (checks/review decision); polled while open. */
    pullRequest: (taskId: number) => ["github", "pull-request", taskId] as const,
  },

  task: {
    /** Changed-file summary for a task's diff; refetched on the task's `session_idle`. */
    diffSummary: (taskId: number) => ["task", "diff-summary", taskId] as const,
    reviewLoop: (taskId: number) => ["task", "review-loop", taskId] as const,
    reviewRuns: (taskId: number) => ["task", "review-runs", taskId] as const,
  },

  prReviews: {
    list: () => ["pr-reviews"] as const,
    runs: (reviewId: number) => ["pr-reviews", reviewId, "runs"] as const,
  },

  jira: {
    status: () => ["jira", "status"] as const,
    restStatus: () => ["jira", "rest-status"] as const,
    projects: () => ["jira", "projects"] as const,
    projectStatuses: (project: string) => ["jira", "project-statuses", project] as const,
    board: () => ["jira", "board"] as const,
  },
} as const;
