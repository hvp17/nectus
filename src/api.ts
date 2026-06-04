import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatNotificationBody } from "./notificationText";
import {
  isBrowserPreview,
  seedGithubStatus,
  seedJiraBoard,
  seedJiraProjects,
  seedJiraStatus,
  seedPrReviews,
  seedPrReviewRuns,
  seedProfiles,
  seedPullRequest,
  seedRepos,
  seedReviewLoop,
  seedReviewRuns,
  seedSettings,
  seedTasks,
} from "./lib/browserSeed";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  GithubStatus,
  JiraProject,
  JiraStatus,
  JiraWorkItem,
  PrReview,
  PrReviewRun,
  PullRequestInfo,
  Repo,
  ReviewLoop,
  ReviewRun,
  Session,
  SessionOutputSnapshot,
  TaskStatus,
  TaskSummary,
} from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

const browserFallbackProfiles: AgentProfile[] = [
  {
    id: 1,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    name: "Claude",
    agentKind: "claude",
    command: "claude",
    model: null,
    args: [],
    env: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const api = {
  async listRepos(): Promise<Repo[]> {
    if (isBrowserPreview) return seedRepos;
    if (!isTauri) return [];
    return invoke("list_repos");
  },
  async addRepo(path: string): Promise<Repo> {
    return invoke("add_repo", { path });
  },
  async pickRepositoryFolder(): Promise<string | null> {
    if (!isTauri) return null;
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder",
    });
    return typeof selected === "string" ? selected : null;
  },
  async listTasks(repoId?: number): Promise<TaskSummary[]> {
    if (isBrowserPreview) return repoId ? seedTasks.filter((t) => t.repoId === repoId) : seedTasks;
    if (!isTauri) return [];
    return invoke("list_tasks", { repoId: repoId ?? null });
  },
  async createTask(input: {
    repoId: number;
    title: string;
    prompt?: string | null;
    agentProfileId?: number | null;
    hasWorktree?: boolean;
    branchName?: string | null;
    jiraIssueKey?: string | null;
    jiraIssueSummary?: string | null;
    jiraIssueUrl?: string | null;
  }): Promise<TaskSummary> {
    return invoke("create_task", {
      repoId: input.repoId,
      title: input.title,
      prompt: input.prompt ?? null,
      agentProfileId: input.agentProfileId ?? null,
      hasWorktree: input.hasWorktree ?? false,
      branchName: input.branchName ?? null,
      jiraIssueKey: input.jiraIssueKey ?? null,
      jiraIssueSummary: input.jiraIssueSummary ?? null,
      jiraIssueUrl: input.jiraIssueUrl ?? null,
    });
  },
  async updateTaskMetadata(input: {
    taskId: number;
    title?: string | null;
    status?: TaskStatus | null;
    prUrl?: string | null;
  }): Promise<TaskSummary> {
    const payload = {
      taskId: input.taskId,
      title: input.title ?? null,
      status: input.status ?? null,
      prUrl: input.prUrl ?? null,
    };
    return invoke<TaskSummary>("update_task_metadata", payload);
  },
  async deleteTask(taskId: number): Promise<void> {
    return invoke("delete_task", { taskId });
  },
  async githubStatus(): Promise<GithubStatus> {
    if (isBrowserPreview) return seedGithubStatus;
    if (!isTauri) return { installed: false, authenticated: false, account: null };
    return invoke("github_status");
  },
  async createGithubPullRequest(input: {
    taskId: number;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<TaskSummary> {
    return invoke("create_github_pull_request", {
      taskId: input.taskId,
      title: input.title,
      body: input.body,
      draft: input.draft,
    });
  },
  async githubPullRequestStatus(taskId: number): Promise<PullRequestInfo> {
    if (isBrowserPreview) return seedPullRequest(taskId);
    return invoke("github_pull_request_status", { taskId });
  },
  async detectGithubPullRequest(taskId: number): Promise<TaskSummary | null> {
    if (!isTauri) return null;
    return invoke("detect_github_pull_request", { taskId });
  },
  async jiraStatus(): Promise<JiraStatus> {
    if (isBrowserPreview) return seedJiraStatus;
    if (!isTauri) return { installed: false, authenticated: false, account: null, site: null };
    return invoke("jira_status");
  },
  async jiraListProjects(): Promise<JiraProject[]> {
    if (isBrowserPreview) return seedJiraProjects;
    if (!isTauri) return [];
    return invoke("jira_list_projects");
  },
  async jiraSearchBoard(): Promise<JiraWorkItem[]> {
    if (isBrowserPreview) return seedJiraBoard;
    if (!isTauri) return [];
    return invoke("jira_search_board");
  },
  async jiraGetWorkItem(key: string): Promise<JiraWorkItem> {
    return invoke("jira_get_work_item", { key });
  },
  async jiraTransitionWorkItem(key: string, status: string): Promise<void> {
    return invoke("jira_transition_work_item", { key, status });
  },
  async jiraAssignWorkItem(key: string, assignee: string): Promise<void> {
    return invoke("jira_assign_work_item", { key, assignee });
  },
  async jiraCommentWorkItem(key: string, body: string): Promise<void> {
    return invoke("jira_comment_work_item", { key, body });
  },
  async setTaskJiraLink(input: {
    taskId: number;
    key?: string | null;
    summary?: string | null;
    url?: string | null;
  }): Promise<TaskSummary> {
    return invoke("set_task_jira_link", {
      taskId: input.taskId,
      key: input.key ?? null,
      summary: input.summary ?? null,
      url: input.url ?? null,
    });
  },
  async createPrReview(input: {
    prUrl: string;
    reviewerProfileIds?: number[] | null;
    maxRounds?: number | null;
  }): Promise<PrReview> {
    return invoke("create_pr_review", {
      prUrl: input.prUrl,
      reviewerProfileIds: input.reviewerProfileIds ?? null,
      maxRounds: input.maxRounds ?? null,
    });
  },
  async listPrReviews(): Promise<PrReview[]> {
    if (isBrowserPreview) return seedPrReviews;
    if (!isTauri) return [];
    return invoke("list_pr_reviews");
  },
  async getPrReview(reviewId: number): Promise<PrReview | null> {
    if (isBrowserPreview) return seedPrReviews.find((review) => review.id === reviewId) ?? null;
    if (!isTauri) return null;
    return invoke("get_pr_review", { reviewId });
  },
  async listPrReviewRuns(reviewId: number): Promise<PrReviewRun[]> {
    if (isBrowserPreview) return seedPrReviewRuns(reviewId);
    if (!isTauri) return [];
    return invoke("list_pr_review_runs", { reviewId });
  },
  async rerunPrReview(reviewId: number): Promise<PrReview> {
    return invoke("rerun_pr_review", { reviewId });
  },
  async deletePrReview(reviewId: number): Promise<void> {
    return invoke("delete_pr_review", { reviewId });
  },
  async listAgentProfiles(): Promise<AgentProfile[]> {
    if (isBrowserPreview) return seedProfiles;
    if (!isTauri) return browserFallbackProfiles;
    return invoke("list_agent_profiles");
  },
  async upsertAgentProfile(
    profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">,
  ): Promise<AgentProfile> {
    return invoke("upsert_agent_profile", { profile });
  },
  async startPairLoop(taskId: number, reviewerProfileId: number): Promise<ReviewLoop> {
    return invoke("start_pair_loop", { taskId, reviewerProfileId });
  },
  async runPairReview(taskId: number): Promise<ReviewLoop> {
    return invoke("run_pair_review", { taskId });
  },
  async stopPairLoop(taskId: number): Promise<ReviewLoop> {
    return invoke("stop_pair_loop", { taskId });
  },
  async getTaskReviewLoop(taskId: number): Promise<ReviewLoop | null> {
    if (isBrowserPreview) return seedReviewLoop(taskId);
    if (!isTauri) return null;
    return invoke("get_task_review_loop", { taskId });
  },
  async listTaskReviewRuns(taskId: number): Promise<ReviewRun[]> {
    if (isBrowserPreview) return seedReviewRuns(taskId);
    if (!isTauri) return [];
    return invoke("list_task_review_runs", { taskId });
  },
  async getAppSettings(): Promise<AppSettings> {
    if (isBrowserPreview) return seedSettings;
    if (!isTauri) {
      return {
        defaultAgentProfileId: browserFallbackProfiles[0]?.id ?? null,
        defaultWorktreeRootPattern: "../{repoName}-worktrees",
        defaultBranchPrefix: null,
        jiraBoardJql: null,
        jiraSiteUrl: null,
        jiraBoardProject: null,
        jiraFilterMyIssues: false,
        jiraFilterUnresolved: true,
        jiraFilterCurrentSprint: false,
        theme: "system",
        density: "comfortable",
        updatedAt: new Date().toISOString(),
      };
    }
    return invoke("get_app_settings");
  },
  async updateAppSettings(settings: AppSettingsInput): Promise<AppSettings> {
    if (isBrowserPreview) return { ...settings, updatedAt: new Date().toISOString() };
    return invoke("update_app_settings", { settings });
  },
  async startSession(taskId: number, agentProfileId: number): Promise<Session> {
    return invoke("start_session", { taskId, agentProfileId });
  },
  async resumeSession(taskId: number): Promise<Session> {
    return invoke("resume_session", { taskId });
  },
  async stopSession(sessionId: string): Promise<Session> {
    return invoke("stop_session", { sessionId });
  },
  async resizeSession(sessionId: string, rows: number, cols: number): Promise<void> {
    if (isBrowserPreview) return;
    return invoke("resize_session", { sessionId, rows, cols });
  },
  async sendSessionInput(sessionId: string, data: string): Promise<void> {
    if (isBrowserPreview) return;
    return invoke("send_session_input", { sessionId, data });
  },
  async submitSessionInput(sessionId: string, data: string): Promise<void> {
    if (isBrowserPreview) return;
    return invoke("submit_session_input", { sessionId, data });
  },
  async sessionOutputSnapshot(sessionId: string): Promise<SessionOutputSnapshot> {
    if (isBrowserPreview) {
      return { sessionId, data: "", truncated: false, startOffset: 0, endOffset: 0, cols: 80, rows: 24 };
    }
    return invoke("session_output_snapshot", { sessionId });
  },
  async openExternalUrl(url: string): Promise<void> {
    if (!isTauri) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    await openUrl(url);
  },
  async sendSystemNotification(title: string, body: string): Promise<boolean> {
    if (!isTauri) return false;

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }

    if (!granted) return false;

    sendNotification({
      title,
      body: formatNotificationBody(body),
    });
    return true;
  },
};
