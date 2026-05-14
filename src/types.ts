export type TaskStatus = "planned" | "in_progress" | "review" | "done";
export type SessionState = "running" | "stopped";

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
  status: TaskStatus;
  prUrl?: string | null;
  agentProfileId?: number | null;
  agentName?: string | null;
  hasWorktree: boolean;
  branchName?: string | null;
  worktreePath?: string | null;
  isDirty: boolean;
  activeSessionId?: string | null;
  lastSessionId?: string | null;
  lastSessionAgent?: string | null;
  lastSessionCwd?: string | null;
  lastSessionLabel?: string | null;
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
}

export interface SessionExitedEvent {
  sessionId: string;
  exitCode?: number | null;
}
