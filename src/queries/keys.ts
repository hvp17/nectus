/**
 * Central catalog of TanStack Query keys.
 *
 * One module owns every key so cache reads/writes (including the Tauri event
 * bridge in the session hooks) reference the same tuples and never drift. Keys are
 * hierarchical so a domain can be invalidated wholesale (e.g. all `["github", …]`).
 *
 * Only keys for reads actually wired to TanStack Query live here. Domain hooks
 * should add keys here as their command reads move into the query layer.
 */
export const queryKeys = {
  repos: () => ["repos"] as const,
  workspaces: () => ["workspaces"] as const,
  tasks: () => ["tasks"] as const,
  /** The archive view (separate cache from the live `tasks` read). */
  tasksArchived: () => ["tasks-archived"] as const,
  agentProfiles: () => ["agent-profiles"] as const,
  acpProviders: () => ["acp-providers"] as const,
  settings: () => ["settings"] as const,

  github: {
    status: () => ["github", "status"] as const,
    /** Best-effort branch PR detection for a worktree task with no linked PR.
     * `repoId` scopes a cross-repo task to one member repo (null → primary). */
    pullRequestDetection: (taskId: number, repoId?: number) =>
      ["github", "pull-request-detection", taskId, repoId ?? null] as const,
    /** Live PR status for one task (checks/review decision); polled while open.
     * `repoId` scopes a cross-repo task to one member repo (null → primary). */
    pullRequest: (taskId: number, repoId?: number) =>
      ["github", "pull-request", taskId, repoId ?? null] as const,
  },

  task: {
    /** Changed-file summary for a task's diff; refetched on the task's `session_idle`.
     * `repoId` scopes a cross-repo task to one member repo (null → primary). */
    diffSummary: (taskId: number, repoId?: number) =>
      ["task", "diff-summary", taskId, repoId ?? null] as const,
    reviewLoop: (taskId: number) => ["task", "review-loop", taskId] as const,
    reviewRuns: (taskId: number) => ["task", "review-runs", taskId] as const,
    /** ACP chat transcript for a task; kept live by the `session_chat` event bridge. */
    chat: (taskId: number) => ["task", "chat", taskId] as const,
  },

  prReviews: {
    list: () => ["pr-reviews"] as const,
    runs: (reviewId: number) => ["pr-reviews", reviewId, "runs"] as const,
  },

  jira: {
    restStatus: () => ["jira", "rest-status"] as const,
    projects: () => ["jira", "projects"] as const,
    projectStatuses: (project: string) => ["jira", "project-statuses", project] as const,
    board: () => ["jira", "board"] as const,
    epics: (project: string) => ["jira", "epics", project] as const,
    sprintBoard: (project: string) => ["jira", "sprint-board", project] as const,
  },
} as const;
