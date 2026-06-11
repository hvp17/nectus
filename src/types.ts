export type TaskStatus = "planned" | "in_progress" | "review" | "done";
export type SessionState = "running" | "stopped";
export type AgentKind = "codex" | "claude" | "gemini" | "opencode" | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type DensityMode = "comfortable" | "compact";
export type ReviewLoopStatus = "running" | "reviewing" | "passed" | "feedback_sent" | "error" | "stopped";
export type ReviewVerdict = "pass" | "needs_changes" | "feedback" | "unknown";
export type PrReviewStatus = "queued" | "reviewing" | "ready" | "error";
export type PrReviewVerdict = "passed" | "blockers" | "inconclusive";
export type PrReviewMode = "single" | "consensus";
export type GithubCheckState = "passing" | "failing" | "pending" | "none";
/** Per-check outcome in the drill-down (no `none`, unlike the rollup state). */
export type GithubCheckRunState = "pass" | "fail" | "pending";
export type PullRequestState = "open" | "merged" | "closed" | "unknown";
export type PullRequestReviewDecision = "approved" | "changes_requested" | "review_required";
/** A `gh pr merge` strategy. */
export type MergeMethod = "squash" | "merge" | "rebase";

export interface Repo {
  id: number;
  name: string;
  path: string;
  defaultWorktreeRoot: string;
  createdAt: string;
  /** Sidebar fold state of this project's nested in-flight agent list. */
  collapsed: boolean;
}

/** A durable, named group of repos (VSCode-workspace style). `repoIds` is ordered. */
export interface Workspace {
  id: number;
  name: string;
  repoIds: number[];
  createdAt: string;
  updatedAt: string;
  /** Sidebar fold state of this workspace's nested in-flight agent list. */
  collapsed: boolean;
}

/** One repo's working state within a task (Increment B). A task spans 1..N repos. */
export interface TaskRepo {
  repoId: number;
  repoName: string;
  branchName?: string | null;
  worktreePath?: string | null;
  prUrl?: string | null;
  isDirty: boolean;
  position: number;
}

export interface TaskSummary {
  id: number;
  repoId: number;
  /** The workspace this task was created in, if any (Increment B). */
  workspaceId?: number | null;
  title: string;
  prompt?: string | null;
  status: TaskStatus;
  prUrl?: string | null;
  agentProfileId?: number | null;
  agentName?: string | null;
  agentKind?: AgentKind | null;
  hasWorktree: boolean;
  branchName?: string | null;
  worktreePath?: string | null;
  isDirty: boolean;
  activeSessionId?: string | null;
  lastSessionId?: string | null;
  lastSessionAgent?: string | null;
  lastSessionCwd?: string | null;
  lastSessionLabel?: string | null;
  reviewLoopStatus?: ReviewLoopStatus | null;
  /**
   * Backend-owned attention signal, persisted so it survives reload: `"needs_input"`
   * when the agent is blocked on you, else `null`. Set/cleared by the session
   * watcher (see `native/src/sessions`); the live in-session detail (prompt/reason)
   * still rides the push-driven `taskAttention` store slice.
   */
  attention?: "needs_input" | null;
  /** Archived tasks are hidden from boards/lists by default. */
  archived: boolean;
  jiraIssueKey?: string | null;
  jiraIssueSummary?: string | null;
  jiraIssueUrl?: string | null;
  /** Every repo this task spans, in display order (Increment B); always ≥1. */
  taskRepos: TaskRepo[];
  createdAt: string;
  updatedAt: string;
}

export type DiffChangeKind = "added" | "modified" | "deleted" | "untracked";

export interface DiffFileEntry {
  path: string;
  change: DiffChangeKind;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface TaskDiffSummary {
  /** What the diff is compared against (e.g. `origin/main`); null for a direct-edit working-tree diff. */
  baseLabel?: string | null;
  files: DiffFileEntry[];
}

export interface GithubStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string | null;
}

export interface GithubCheckSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

/** One CI check / GitHub Actions run in the per-check drill-down. */
export interface GithubCheckRun {
  name: string;
  /** GitHub Actions workflow name, when the check belongs to one. */
  workflow?: string | null;
  state: GithubCheckRunState;
  /** Link to the run's details page (Actions run or status target). */
  url?: string | null;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  reviewDecision?: PullRequestReviewDecision | null;
  checks: GithubCheckSummary;
  checksState: GithubCheckState;
  /** Per-check detail (GitHub Actions + commit statuses) for the drill-down. */
  checkRuns: GithubCheckRun[];
}

export type JiraStatusCategory = "to_do" | "in_progress" | "done" | "unknown";

export interface JiraProject {
  key: string;
  name: string;
}

export interface JiraStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string | null;
  site?: string | null;
}

export interface JiraWorkItem {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: JiraStatusCategory;
  issueType?: string | null;
  priority?: string | null;
  assignee?: string | null;
  url?: string | null;
  description?: string | null;
  /** Parent epic key, when known (the Agile sprint path populates it; null on the
   * plain acli board path). */
  epicKey?: string | null;
  /** Parent epic name/summary, when known. */
  epicName?: string | null;
}

/** A sprint from the Agile REST API (`/rest/agile/1.0/board/{id}/sprint`). */
export interface JiraSprint {
  id: number;
  name: string;
  /** `active`, `future`, or `closed`. */
  state: string;
  startDate?: string | null;
  endDate?: string | null;
  goal?: string | null;
}

/** One sprint-board lane: a sprint and its issues, or the backlog (`sprint: null`). */
export interface JiraSprintLane {
  sprint: JiraSprint | null;
  items: JiraWorkItem[];
}

/** A legal transition for a work item (from `GET /issue/{key}/transitions`). */
export interface JiraTransition {
  id: string;
  name: string;
  toStatusName: string;
  toStatusCategory: JiraStatusCategory;
}

/** A status in a project's workflow (from `GET /project/{key}/statuses`). */
export interface JiraStatusDef {
  id: string;
  name: string;
  category: JiraStatusCategory;
}

/** REST connection state for the optional API-token layer. */
export interface JiraRestStatus {
  connected: boolean;
  site?: string | null;
  email?: string | null;
  error?: string | null;
}

export interface AgentProfile {
  id: number;
  name: string;
  agentKind: AgentKind;
  command: string;
  model?: string | null;
  args: string[];
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLoop {
  taskId: number;
  reviewerProfileId: number;
  status: ReviewLoopStatus;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRun {
  id: number;
  taskId: number;
  reviewerProfileId: number;
  verdict: ReviewVerdict;
  prompt: string;
  output: string;
  error?: string | null;
  createdAt: string;
}

export interface ReviewLoopUpdatedEvent {
  taskId: number;
  reviewLoop: ReviewLoop;
  reviewRun?: ReviewRun | null;
}

/** A chunk of a task reviewer's live stdout. A chunk at `startOffset` 0 marks the
 *  start of a new run, so the live view resets its buffer. */
export interface ReviewOutputEvent {
  taskId: number;
  data: string;
  startOffset: number;
}

/** A chunk of a single PR reviewer's live stdout. A chunk at `startOffset` 0 marks
 *  the start of a new run, so the live view resets its buffer. */
export interface PrReviewOutputEvent {
  reviewId: number;
  data: string;
  startOffset: number;
}

export interface PrReviewReviewer {
  reviewerProfileId: number;
  reviewerName?: string | null;
}

export interface PrReview {
  id: number;
  repoId: number;
  repoName: string;
  /** Single mode: the reviewer. Consensus mode: the synthesizer. */
  reviewerProfileId: number;
  reviewerName?: string | null;
  prUrl: string;
  prNumber: number;
  prTitle?: string | null;
  prAuthor?: string | null;
  baseBranch?: string | null;
  status: PrReviewStatus;
  verdict?: PrReviewVerdict | null;
  reviewOutput?: string | null;
  lastError?: string | null;
  worktreePath?: string | null;
  mode: PrReviewMode;
  /** Consensus only: the iteration cap. */
  maxRounds?: number | null;
  /** Consensus only: how many parallel rounds have finished. */
  roundsCompleted: number;
  /** Consensus only: whether reviewers agreed before the cap (null until done). */
  converged?: boolean | null;
  /** Consensus only: the participating reviewers. Empty for single reviews. */
  reviewers: PrReviewReviewer[];
  createdAt: string;
  updatedAt: string;
}

/** One reviewer's output for one round of a consensus PR review. */
export interface PrReviewRun {
  id: number;
  prReviewId: number;
  reviewerProfileId: number;
  reviewerName?: string | null;
  round: number;
  verdict: PrReviewVerdict;
  output: string;
  error?: string | null;
  createdAt: string;
}

export interface PrReviewUpdatedEvent {
  prReview: PrReview;
  latestRun?: PrReviewRun | null;
}

export interface AppSettings {
  defaultAgentProfileId?: number | null;
  defaultWorktreeRootPattern: string;
  defaultBranchPrefix?: string | null;
  jiraBoardJql?: string | null;
  jiraSiteUrl?: string | null;
  jiraBoardProject?: string | null;
  jiraFilterMyIssues: boolean;
  jiraFilterUnresolved: boolean;
  jiraFilterCurrentSprint: boolean;
  /** Non-secret REST account email; written only by the API-token flow. */
  jiraRestEmail?: string | null;
  /** Board status filter selection; empty means no filter. */
  jiraFilterStatuses: string[];
  /** Board epic filter (an epic key); null/absent means no epic filter. */
  jiraFilterEpic?: string | null;
  /** Opt-in tmux-backed sessions: keep agents running while the app is closed
   * and reattach on the next launch. Requires tmux >= 3.2 on the machine. */
  persistentSessions: boolean;
  theme: ThemeMode;
  density: DensityMode;
  updatedAt: string;
}

export interface AppSettingsInput {
  defaultAgentProfileId?: number | null;
  defaultWorktreeRootPattern: string;
  defaultBranchPrefix?: string | null;
  jiraBoardJql?: string | null;
  jiraSiteUrl?: string | null;
  jiraBoardProject?: string | null;
  jiraFilterMyIssues: boolean;
  jiraFilterUnresolved: boolean;
  jiraFilterCurrentSprint: boolean;
  jiraFilterStatuses: string[];
  jiraFilterEpic?: string | null;
  persistentSessions: boolean;
  theme: ThemeMode;
  density: DensityMode;
}

export interface Session {
  id: string;
  resumableSessionId?: string | null;
  resumableSessionLabel?: string | null;
  taskId: number;
  agentProfileId: number;
  state: SessionState;
  pid?: number | null;
  startedAt: string;
  stoppedAt?: string | null;
}

export interface SessionOutputEvent {
  sessionId: string;
  data: string;
  startOffset: number;
}

export interface SessionOutputSnapshot {
  sessionId: string;
  data: string;
  truncated: boolean;
  startOffset: number;
  endOffset: number;
  /** Terminal size the buffered output was generated at, so replay can match it. */
  cols: number;
  rows: number;
}

export interface SessionExitedEvent {
  sessionId: string;
  exitCode?: number | null;
}

export interface SessionIdleEvent {
  sessionId: string;
  taskId: number;
  turnId?: string | null;
  message?: string | null;
}

export interface SessionNeedsInputEvent {
  sessionId: string;
  taskId: number;
  turnId?: string | null;
  reason: string;
  prompt?: string | null;
}

/** The agent's latest human-readable activity line for a running session. */
export interface SessionActivityEvent {
  sessionId: string;
  taskId: number;
  line: string;
}
