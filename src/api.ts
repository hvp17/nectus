import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { AgentProfile, Repo, Session, SessionOutputSnapshot, TaskStatus, TaskSummary } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
const notificationBodyLimit = 240;

const demoProfiles: AgentProfile[] = [
  {
    id: 1,
    name: "Codex",
    command: "codex",
    args: [],
    env: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    name: "Claude",
    command: "claude",
    args: [],
    env: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const api = {
  async listRepos(): Promise<Repo[]> {
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
    if (!isTauri) return [];
    return invoke("list_tasks", { repoId: repoId ?? null });
  },
  async createTask(input: {
    repoId: number;
    title: string;
    agentProfileId?: number | null;
    hasWorktree?: boolean;
    branchName?: string | null;
  }): Promise<TaskSummary> {
    return invoke("create_task", {
      repoId: input.repoId,
      title: input.title,
      agentProfileId: input.agentProfileId ?? null,
      hasWorktree: input.hasWorktree ?? false,
      branchName: input.branchName ?? null,
    });
  },
  async updateTaskMetadata(input: {
    taskId: number;
    title?: string | null;
    status?: TaskStatus | null;
    prUrl?: string | null;
  }): Promise<TaskSummary> {
    return invoke("update_task_metadata", input);
  },
  async deleteTask(taskId: number): Promise<void> {
    return invoke("delete_task", { taskId });
  },
  async listAgentProfiles(): Promise<AgentProfile[]> {
    if (!isTauri) return demoProfiles;
    return invoke("list_agent_profiles");
  },
  async upsertAgentProfile(profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "command">): Promise<AgentProfile> {
    return invoke("upsert_agent_profile", { profile });
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
    return invoke("resize_session", { sessionId, rows, cols });
  },
  async sendSessionInput(sessionId: string, data: string): Promise<void> {
    return invoke("send_session_input", { sessionId, data });
  },
  async sessionOutputSnapshot(sessionId: string): Promise<SessionOutputSnapshot> {
    return invoke("session_output_snapshot", { sessionId });
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
      body: body.length > notificationBodyLimit ? `${body.slice(0, notificationBodyLimit - 3)}...` : body,
    });
    return true;
  },
};
