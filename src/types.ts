export type TaskStatus = "planned" | "in_progress" | "review" | "done";
export type SessionState = "running" | "stopped";
export type AgentKind = "codex" | "claude" | "gemini" | "custom";
export type ThemeMode = "system" | "light" | "dark";
export type DensityMode = "comfortable" | "compact";
export type ReviewLoopStatus = "running" | "reviewing" | "passed" | "feedback_sent" | "error" | "stopped";
export type ReviewVerdict = "pass" | "needs_changes" | "feedback" | "unknown";
export type PrReviewStatus = "queued" | "reviewing" | "ready" | "error";
export type PrReviewVerdict = "passed" | "blockers" | "inconclusive";
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
  assignee?: string | null;
  url?: string | null;
  description?: string | null;
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

export interface PrReview {
  id: number;
  repoId: number;
  repoName: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface PrReviewUpdatedEvent {
  prReview: PrReview;
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
