export type TaskStatus = "planned" | "in_progress" | "review" | "done";
export type SessionState = "running" | "stopped";
export type AgentKind = "codex" | "claude" | "gemini" | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type DensityMode = "comfortable" | "compact";
export type ReviewLoopStatus = "running" | "reviewing" | "passed" | "feedback_sent" | "error" | "stopped";
export type ReviewVerdict = "pass" | "needs_changes" | "feedback" | "unknown";
export type PrReviewStatus = "queued" | "reviewing" | "ready" | "error";
export type PrReviewVerdict = "passed" | "blockers" | "inconclusive";
export type PrReviewMode = "single" | "consensus";
export type GithubCheckState = "passing" | "failing" | "pending" | "none";
export type PullRequestState = "open" | "merged" | "closed" | "unknown";
export type PullRequestReviewDecision = "approved" | "changes_requested" | "review_required";

export interface Repo {
  id: number;
  name: string;
  path: string;
  defaultWorktreeRoot: string;
  createdAt: string;
}

export interface TaskSummary {
  id: number;
  repoId: number;
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
  jiraIssueKey?: string | null;
  jiraIssueSummary?: string | null;
  jiraIssueUrl?: string | null;
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

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  reviewDecision?: PullRequestReviewDecision | null;
  checks: GithubCheckSummary;
  checksState: GithubCheckState;
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
