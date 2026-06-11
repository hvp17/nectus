// Seed data for browser-only preview (`pnpm dev`), so every page renders with
// realistic content without the Tauri backend. Ported from the design handoff's
// mock dataset and adapted to the real data contracts.
//
// Gated on `isBrowserPreview`: true only outside Tauri AND outside the test
// runner, so the test suite (which exercises the real empty fallbacks and mocks
// `api` directly) is never affected.
import type {
  AgentProfile,
  AppSettings,
  DiffFileEntry,
  GithubStatus,
  JiraProject,
  JiraSprintLane,
  JiraStatus,
  JiraWorkItem,
  PrReview,
  PrReviewRun,
  PullRequestInfo,
  Repo,
  ReviewLoop,
  ReviewRun,
  TaskDiffSummary,
  TaskSummary,
  Workspace,
} from "../types";


const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const seedProfiles: AgentProfile[] = [
  { id: 1, name: "Codex", agentKind: "codex", command: "codex", model: null, args: [], env: {}, createdAt: ago(9000), updatedAt: ago(9000) },
  { id: 2, name: "Claude Sonnet", agentKind: "claude", command: "claude", model: "sonnet", args: [], env: {}, createdAt: ago(9000), updatedAt: ago(9000) },
  { id: 3, name: "Gemini", agentKind: "gemini", command: "gemini", model: null, args: [], env: {}, createdAt: ago(9000), updatedAt: ago(9000) },
  { id: 4, name: "OpenCode", agentKind: "opencode", command: "opencode", model: null, args: [], env: {}, createdAt: ago(9000), updatedAt: ago(9000) },
];

export const seedRepos: Repo[] = [
  { id: 1, name: "web-app", path: "/Users/you/dev/web-app", defaultWorktreeRoot: "/Users/you/dev/web-app-worktrees", createdAt: ago(20000), collapsed: false },
  { id: 2, name: "cli-tools", path: "/Users/you/dev/cli-tools", defaultWorktreeRoot: "/Users/you/dev/cli-tools-worktrees", createdAt: ago(20000), collapsed: false },
  { id: 3, name: "design-system", path: "/Users/you/dev/design-system", defaultWorktreeRoot: "/Users/you/dev/design-system-worktrees", createdAt: ago(20000), collapsed: false },
];

// A sample workspace grouping the front-end stack (web-app + design-system), so
// the workspace switcher and its filter are previewable in `pnpm dev`.
export const seedWorkspaces: Workspace[] = [
  { id: 1, name: "Web platform", repoIds: [1, 3], createdAt: ago(18000), updatedAt: ago(1200), collapsed: false },
];

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, "id" | "repoId" | "title">): TaskSummary {
  return {
    workspaceId: null,
    taskRepos: [],
    prompt: null,
    status: "in_progress",
    prUrl: null,
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: null,
    worktreePath: null,
    archived: false,
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    reviewLoopStatus: null,
    jiraIssueKey: null,
    jiraIssueSummary: null,
    jiraIssueUrl: null,
    createdAt: ago(600),
    updatedAt: ago(5),
    ...partial,
  };
}

export const seedTasks: TaskSummary[] = [
  task({
    id: 1, repoId: 1, title: "Fix OAuth redirect loop on sign-in", status: "in_progress",
    agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude", branchName: "fix/oauth-redirect",
    worktreePath: "/Users/you/dev/web-app-worktrees/oauth-redirect", isDirty: true,
    activeSessionId: "s-1", lastSessionId: "s-1", lastSessionAgent: "claude",
    jiraIssueKey: "WEB-412", jiraIssueSummary: "Fix OAuth redirect loop on sign-in",
    prompt: "Users with a stale session cookie bounce between /login and the callback URL. Reproduce and fix.",
    updatedAt: ago(4),
  }),
  task({
    id: 2, repoId: 1, title: "Add JIRA board status filters", status: "review",
    agentProfileId: 1, agentName: "Codex", agentKind: "codex", branchName: "feat/jira-filters",
    worktreePath: "/Users/you/dev/web-app-worktrees/jira-filters", activeSessionId: "s-2", lastSessionId: "s-2",
    jiraIssueKey: "WEB-409", jiraIssueSummary: "Add JIRA board status filters", updatedAt: ago(1),
  }),
  task({
    id: 3, repoId: 2, title: "Stream agent logs to a file sink", agentProfileId: 4, agentName: "OpenCode", agentKind: "opencode",
    branchName: "feat/log-sink", worktreePath: "/Users/you/dev/cli-tools-worktrees/log-sink", isDirty: true,
    activeSessionId: "s-3", lastSessionId: "s-3", jiraIssueKey: "CLI-88", updatedAt: ago(12),
  }),
  task({
    id: 4, repoId: 1, title: "Worktree cleanup confirmation flow", branchName: "feat/worktree-cleanup",
    worktreePath: "/Users/you/dev/web-app-worktrees/worktree-cleanup", isDirty: true, activeSessionId: "s-4", lastSessionId: "s-4", updatedAt: ago(6),
  }),
  task({
    id: 5, repoId: 3, title: "Token contrast audit for dark theme", agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude",
    branchName: "fix/dark-contrast", worktreePath: "/Users/you/dev/design-system-worktrees/dark-contrast",
    activeSessionId: "s-5", lastSessionId: "s-5", updatedAt: ago(2),
  }),
  task({
    id: 6, repoId: 1, title: "Reduce SQLite write contention", status: "review", agentProfileId: 3, agentName: "Gemini", agentKind: "gemini",
    branchName: "perf/sqlite-wal", worktreePath: "/Users/you/dev/web-app-worktrees/sqlite-wal", reviewLoopStatus: "passed",
    jiraIssueKey: "WEB-405", jiraIssueSummary: "Reduce SQLite write contention under parallel agents", updatedAt: ago(22),
  }),
  task({
    id: 7, repoId: 2, title: "Add --json output to status command", status: "review", agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude",
    branchName: "feat/json-status", worktreePath: "/Users/you/dev/cli-tools-worktrees/json-status", reviewLoopStatus: "reviewing",
    activeSessionId: "s-7", lastSessionId: "s-7", jiraIssueKey: "CLI-90", updatedAt: ago(8),
  }),
  task({
    id: 8, repoId: 3, title: "Document elevation + shadow scale", status: "done", agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude",
    branchName: "docs/elevation", worktreePath: "/Users/you/dev/design-system-worktrees/elevation",
    prUrl: "https://github.com/hvp17/design-system/pull/214", jiraIssueKey: "DS-18", lastSessionId: "s-8", updatedAt: ago(70),
  }),
  task({
    id: 9, repoId: 1, title: "Persist terminal scrollback per session", status: "planned", agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude",
    hasWorktree: false, jiraIssueKey: "WEB-418", jiraIssueSummary: "Persist terminal scrollback per session", updatedAt: ago(140),
  }),
  // A cross-repo task (Increment B): one agent across the Web platform workspace's
  // repos, each on its own sibling worktree under a shared parent.
  task({
    id: 10, repoId: 1, title: "Unify button tokens across web-app and design-system", status: "in_progress",
    workspaceId: 1, agentProfileId: 2, agentName: "Claude Sonnet", agentKind: "claude",
    branchName: "feat/button-tokens", isDirty: true,
    worktreePath: "/Users/you/dev/web-app-worktrees/workspaces/feat/button-tokens/web-app",
    activeSessionId: "s-10", lastSessionId: "s-10",
    taskRepos: [
      { repoId: 1, repoName: "web-app", branchName: "feat/button-tokens", worktreePath: "/Users/you/dev/web-app-worktrees/workspaces/feat/button-tokens/web-app", prUrl: null, isDirty: true, position: 0 },
      { repoId: 3, repoName: "design-system", branchName: "feat/button-tokens", worktreePath: "/Users/you/dev/web-app-worktrees/workspaces/feat/button-tokens/design-system", prUrl: null, isDirty: false, position: 1 },
    ],
    updatedAt: ago(3),
  }),
];


/**
 * Live activity lines for running seed tasks (those with a `Live` badge), so the
 * board and Mission Control show the "what it's doing" stream in browser preview.
 */

export const seedSettings: AppSettings = {
  defaultAgentProfileId: 1,
  defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
  defaultBranchPrefix: "feat/",
  jiraBoardJql: null,
  jiraSiteUrl: "acme.atlassian.net",
  jiraBoardProject: "WEB",
  jiraFilterMyIssues: false,
  jiraFilterUnresolved: true,
  jiraFilterCurrentSprint: false,
  jiraFilterStatuses: [],
  persistentSessions: false,
  theme: "system",
  density: "comfortable",
  updatedAt: ago(5000),
};

export const seedGithubStatus: GithubStatus = { installed: true, authenticated: true, account: "hvp17" };
export const seedJiraStatus: JiraStatus = { installed: true, authenticated: true, account: "hvp17", site: "acme.atlassian.net" };
export const seedJiraProjects: JiraProject[] = [
  { key: "WEB", name: "web-app" },
  { key: "CLI", name: "cli-tools" },
  { key: "DS", name: "design-system" },
];

export const seedJiraBoard: JiraWorkItem[] = [
  { key: "WEB-418", summary: "Persist terminal scrollback per session so refresh keeps context", statusName: "To Do", statusCategory: "to_do", issueType: "Story", priority: "High", assignee: "You" },
  { key: "WEB-421", summary: "Worktree cleanup leaves dangling lockfiles on force-quit", statusName: "To Do", statusCategory: "to_do", issueType: "Bug", priority: "Medium", assignee: "R. Okafor" },
  { key: "WEB-412", summary: "Fix OAuth redirect loop on sign-in", statusName: "In Progress", statusCategory: "in_progress", issueType: "Bug", priority: "Highest", assignee: "You", description: "Users with a stale session cookie are bounced between /login and the callback URL indefinitely." },
  { key: "WEB-409", summary: "Add JIRA board status filters", statusName: "In Progress", statusCategory: "in_progress", issueType: "Task", priority: "Medium", assignee: "You" },
  { key: "WEB-405", summary: "Reduce SQLite write contention under parallel agents", statusName: "In Review", statusCategory: "in_progress", issueType: "Task", priority: "High", assignee: "M. Reyes" },
  { key: "WEB-398", summary: "Resume Codex sessions from saved session id", statusName: "Done", statusCategory: "done", issueType: "Story", priority: "Low", assignee: "K. Fowler" },
];

export const seedJiraEpics: JiraWorkItem[] = [
  { key: "WEB-400", summary: "Session persistence & resume", statusName: "In Progress", statusCategory: "in_progress", issueType: "Epic", priority: "High", assignee: "You" },
  { key: "WEB-380", summary: "Auth hardening", statusName: "To Do", statusCategory: "to_do", issueType: "Epic", priority: "Medium", assignee: "M. Reyes" },
];

export const seedJiraSprintBoard: JiraSprintLane[] = [
  {
    sprint: { id: 1, name: "WEB Sprint 24", state: "active", startDate: ago(7 * 24 * 60), endDate: ago(-7 * 24 * 60), goal: "Stabilize sessions & sign-in" },
    items: [
      { key: "WEB-412", summary: "Fix OAuth redirect loop on sign-in", statusName: "In Progress", statusCategory: "in_progress", issueType: "Bug", priority: "Highest", assignee: "You", epicKey: "WEB-380", epicName: "Auth hardening" },
      { key: "WEB-405", summary: "Reduce SQLite write contention under parallel agents", statusName: "In Review", statusCategory: "in_progress", issueType: "Task", priority: "High", assignee: "M. Reyes", epicKey: "WEB-400", epicName: "Session persistence & resume" },
      { key: "WEB-418", summary: "Persist terminal scrollback per session so refresh keeps context", statusName: "To Do", statusCategory: "to_do", issueType: "Story", priority: "High", assignee: "You", epicKey: "WEB-400", epicName: "Session persistence & resume" },
    ],
  },
  {
    sprint: { id: 2, name: "WEB Sprint 25", state: "future", startDate: ago(-7 * 24 * 60), endDate: ago(-21 * 24 * 60), goal: null },
    items: [
      { key: "WEB-421", summary: "Worktree cleanup leaves dangling lockfiles on force-quit", statusName: "To Do", statusCategory: "to_do", issueType: "Bug", priority: "Medium", assignee: "R. Okafor" },
    ],
  },
  {
    sprint: null,
    items: [
      { key: "WEB-398", summary: "Resume Codex sessions from saved session id", statusName: "To Do", statusCategory: "to_do", issueType: "Story", priority: "Low", assignee: "K. Fowler", epicKey: "WEB-400", epicName: "Session persistence & resume" },
      { key: "WEB-377", summary: "Audit log for token connect/disconnect", statusName: "To Do", statusCategory: "to_do", issueType: "Task", priority: "Low", assignee: "M. Reyes", epicKey: "WEB-380", epicName: "Auth hardening" },
    ],
  },
];

const consensusOutput = `**Blocking: writer starvation risk.** Enabling WAL without re-setting busy_timeout means concurrent task writers can fail with SQLITE_BUSY under the parallel-agent workload.

Add \`PRAGMA busy_timeout=5000\` and a write retry, then re-review.`;

const singleOutput = `Verdict: Passed

## Summary
The change correctly identifies the stale-cookie path that re-enters /login and short-circuits it. Scope is tight; the added test captures the regression well.

✓ Correctness — callback now refreshes before redirecting
✓ Tests — new case covers the expired-cookie branch
▲ Nit — consider logging the refresh failure at warn

## Recommendation
Ship it. The nit is non-blocking and can land in a follow-up.`;

export const seedPrReviews: PrReview[] = [
  {
    id: 1, repoId: 1, repoName: "web-app", reviewerProfileId: 2, reviewerName: "Claude Sonnet",
    prUrl: "https://github.com/hvp17/web-app/pull/412", prNumber: 412, prTitle: "Fix OAuth redirect loop on sign-in",
    prAuthor: "hvp17", baseBranch: "main", status: "ready", verdict: "passed", reviewOutput: singleOutput,
    lastError: null, worktreePath: null,
    mode: "single", maxRounds: null, roundsCompleted: 0, converged: null, reviewers: [],
    createdAt: ago(120), updatedAt: ago(118),
  },
  {
    id: 2, repoId: 1, repoName: "web-app", reviewerProfileId: 2, reviewerName: "Claude Sonnet",
    prUrl: "https://github.com/hvp17/web-app/pull/408", prNumber: 408, prTitle: "Migrate session store to SQLite WAL",
    prAuthor: "hvp17", baseBranch: "main", status: "ready", verdict: "blockers", reviewOutput: consensusOutput,
    lastError: null, worktreePath: null,
    mode: "consensus", maxRounds: 3, roundsCompleted: 2, converged: true,
    reviewers: [
      { reviewerProfileId: 2, reviewerName: "Claude Sonnet" },
      { reviewerProfileId: 1, reviewerName: "Codex" },
      { reviewerProfileId: 3, reviewerName: "Gemini" },
    ],
    createdAt: ago(200), updatedAt: ago(190),
  },
  {
    id: 3, repoId: 2, repoName: "cli-tools", reviewerProfileId: 1, reviewerName: "Codex",
    prUrl: "https://github.com/hvp17/cli-tools/pull/415", prNumber: 415, prTitle: "Add --json output to status command",
    prAuthor: "kfowler", baseBranch: "main", status: "reviewing", verdict: null, reviewOutput: null,
    lastError: null, worktreePath: null,
    mode: "consensus", maxRounds: 2, roundsCompleted: 1, converged: null,
    reviewers: [
      { reviewerProfileId: 1, reviewerName: "Codex" },
      { reviewerProfileId: 3, reviewerName: "Gemini" },
    ],
    createdAt: ago(6), updatedAt: ago(2),
  },
  {
    id: 4, repoId: 3, repoName: "design-system", reviewerProfileId: 2, reviewerName: "Claude Sonnet",
    prUrl: "https://github.com/hvp17/design-system/pull/217", prNumber: 217, prTitle: "Document elevation + shadow scale",
    prAuthor: "mreyes", baseBranch: "main", status: "queued", verdict: null, reviewOutput: null,
    lastError: null, worktreePath: null,
    mode: "single", maxRounds: null, roundsCompleted: 0, converged: null, reviewers: [],
    createdAt: ago(1), updatedAt: ago(1),
  },
];

// The per-(reviewer, round) verdict matrix for the consensus reviews above,
// matching main's PrReviewRun shape that PrReviewDetail buckets by round.
const run = (
  id: number,
  prReviewId: number,
  reviewerProfileId: number,
  reviewerName: string,
  round: number,
  verdict: PrReviewRun["verdict"],
  output: string,
): PrReviewRun => ({ id, prReviewId, reviewerProfileId, reviewerName, round, verdict, output, error: null, createdAt: ago(190) });

const prReviewRunsByReview: Record<number, PrReviewRun[]> = {
  2: [
    run(1, 2, 2, "Claude Sonnet", 1, "blockers", "WAL alone leaves writers exposed to SQLITE_BUSY under parallel agents."),
    run(2, 2, 1, "Codex", 1, "blockers", "No busy_timeout/retry — concurrent writers will fail intermittently."),
    run(3, 2, 3, "Gemini", 1, "inconclusive", "Likely fine for low concurrency; need to see the writer path."),
    run(4, 2, 2, "Claude Sonnet", 2, "blockers", "Confirmed after seeing round 1: add busy_timeout + retry before merge."),
    run(5, 2, 1, "Codex", 2, "blockers", "Agree with Claude; this is a blocker."),
    run(6, 2, 3, "Gemini", 2, "blockers", "Persuaded by the contention trace — blocking."),
  ],
  3: [
    run(7, 3, 1, "Codex", 1, "passed", "Clean --json surface; matches the documented schema."),
    run(8, 3, 3, "Gemini", 1, "blockers", "Non-zero exit still prints human text on stderr; breaks --json consumers."),
  ],
};

export function seedPrReviewRuns(reviewId: number): PrReviewRun[] {
  return prReviewRunsByReview[reviewId] ?? [];
}

export function seedPullRequest(taskId: number): PullRequestInfo {
  return {
    number: taskId === 8 ? 214 : 0,
    url: "https://github.com/hvp17/design-system/pull/214",
    title: "Document elevation + shadow scale",
    state: "open",
    isDraft: false,
    reviewDecision: "review_required",
    checks: { total: 9, passed: 8, failed: 0, pending: 1 },
    checksState: "pending",
    checkRuns: [
      { name: "build", workflow: "CI", state: "pass", url: "https://github.com/hvp17/design-system/actions/runs/1" },
      { name: "unit-tests", workflow: "CI", state: "pass", url: "https://github.com/hvp17/design-system/actions/runs/2" },
      { name: "e2e", workflow: "CI", state: "pending", url: "https://github.com/hvp17/design-system/actions/runs/3" },
      { name: "lint", workflow: "Quality", state: "pass", url: "https://github.com/hvp17/design-system/actions/runs/4" },
    ],
  };
}

export function seedReviewLoop(taskId: number): ReviewLoop | null {
  if (taskId === 6) return { taskId, reviewerProfileId: 2, status: "passed", lastError: null, createdAt: ago(40), updatedAt: ago(30) };
  if (taskId === 7) return { taskId, reviewerProfileId: 1, status: "reviewing", lastError: null, createdAt: ago(8), updatedAt: ago(2) };
  return null;
}

export function seedReviewRuns(taskId: number): ReviewRun[] {
  if (taskId === 6) {
    return [
      {
        id: 1, taskId, reviewerProfileId: 2, verdict: "pass", prompt: "Review the worktree",
        output: "PASS: WAL enabled and writes batched. No contention under the stress test — ready to merge.",
        error: null, createdAt: ago(30),
      },
    ];
  }
  return [];
}

// A small, realistic diff for the OAuth task so the Diff tab renders in `pnpm dev`;
// every other task gets a one-file fallback so the tab is never empty in preview.
const seedDiffFiles: DiffFileEntry[] = [
  { path: "src/auth/session.ts", change: "modified", additions: 12, deletions: 4, binary: false },
  { path: "src/auth/redirect.ts", change: "modified", additions: 3, deletions: 9, binary: false },
  { path: "src/auth/__tests__/redirect.test.ts", change: "added", additions: 38, deletions: 0, binary: false },
  { path: "docs/auth-flow.md", change: "untracked", additions: 21, deletions: 0, binary: false },
];

const seedDiffPatches: Record<string, string> = {
  "src/auth/redirect.ts": `diff --git a/src/auth/redirect.ts b/src/auth/redirect.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth/redirect.ts
+++ b/src/auth/redirect.ts
@@ -10,13 +10,7 @@ export function resolveRedirect(session: Session, target: string) {
-  // Stale cookies bounce between /login and the callback forever.
-  if (!session.isValid()) {
-    return "/login";
-  }
-  if (target.startsWith("/login")) {
-    return "/login";
-  }
-  return target;
+  if (!session.isValid()) return "/login";
+  // Break the loop: never redirect back to an auth route.
+  return isAuthRoute(target) ? "/" : target;
 }`,
};

export function seedTaskDiffSummary(taskId: number): TaskDiffSummary {
  if (taskId === 1) return { baseLabel: "origin/main", files: seedDiffFiles };
  return {
    baseLabel: "origin/main",
    files: [{ path: "src/index.ts", change: "modified", additions: 6, deletions: 2, binary: false }],
  };
}

export function seedTaskDiffFile(taskId: number, file: string): string {
  if (taskId === 1 && seedDiffPatches[file]) return seedDiffPatches[file];
  return `diff --git a/${file} b/${file}
index 0000000..1111111 100644
--- a/${file}
+++ b/${file}
@@ -1,4 +1,5 @@
 export function handler() {
-  return run();
+  // Preview-only sample patch.
+  return run({ retries: 2 });
 }`;
}
