import { invoke } from "@tauri-apps/api/core";
import type { AgentProfile, Repo, Session, WorktreeSummary, WorktreeStatus } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

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
  async listWorktrees(repoId?: number): Promise<WorktreeSummary[]> {
    if (!isTauri) return [];
    return invoke("list_worktrees", { repoId: repoId ?? null });
  },
  async createWorktree(input: {
    repoId: number;
    branchName: string;
    taskTitle: string;
    agentProfileId?: number | null;
  }): Promise<WorktreeSummary> {
    return invoke("create_worktree", {
      repoId: input.repoId,
      branchName: input.branchName,
      taskTitle: input.taskTitle,
      agentProfileId: input.agentProfileId ?? null,
    });
  },
  async updateWorktreeMetadata(input: {
    worktreeId: number;
    taskTitle?: string | null;
    status?: WorktreeStatus | null;
    prUrl?: string | null;
  }): Promise<WorktreeSummary> {
    return invoke("update_worktree_metadata", input);
  },
  async listAgentProfiles(): Promise<AgentProfile[]> {
    if (!isTauri) return demoProfiles;
    return invoke("list_agent_profiles");
  },
  async upsertAgentProfile(profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "command">): Promise<AgentProfile> {
    return invoke("upsert_agent_profile", { profile });
  },
  async startSession(worktreeId: number, agentProfileId: number): Promise<Session> {
    return invoke("start_session", { worktreeId, agentProfileId });
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
};

