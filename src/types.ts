export type WorktreeStatus = "planned" | "in_progress" | "review" | "done";
export type SessionState = "running" | "stopped";

export interface Repo {
  id: number;
  name: string;
  path: string;
  defaultWorktreeRoot: string;
  createdAt: string;
}

export interface WorktreeSummary {
  id: number;
  repoId: number;
  branchName: string;
  path: string;
  taskTitle: string;
  status: WorktreeStatus;
  prUrl?: string | null;
  agentProfileId?: number | null;
  agentName?: string | null;
  isDirty: boolean;
  activeSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: number;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  worktreeId: number;
  agentProfileId: number;
  state: SessionState;
  pid?: number | null;
  startedAt: string;
  stoppedAt?: string | null;
}

export interface SessionOutputEvent {
  sessionId: string;
  data: string;
}

export interface SessionExitedEvent {
  sessionId: string;
  exitCode?: number | null;
}

