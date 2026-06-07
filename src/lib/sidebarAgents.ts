import { ACTIVE_AGENT_STATES, buildAgentRows, type AgentRow, type AgentState } from "./agentState";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary, Workspace } from "../types";

export interface SidebarAgents {
  /** repoId -> active agent rows in that repo. */
  byRepo: Map<number, AgentRow[]>;
  /** workspaceId -> active agent rows across the workspace's repos (deduped). */
  byWorkspace: Map<number, AgentRow[]>;
}

/**
 * Bucket the in-flight agents ([[ACTIVE_AGENT_STATES]]) for the merged sidebar:
 * by their project, and by every workspace whose repo set contains that project.
 * An agent intentionally surfaces under both lenses.
 */
export function buildSidebarAgents(
  tasks: TaskSummary[],
  taskAttention: TaskAttention[],
  repos: Repo[],
  workspaces: Workspace[],
  liveLines: Record<number, string> = {},
  now = Date.now(),
): SidebarAgents {
  const repoNames = new Map(repos.map((repo) => [repo.id, repo.name]));
  const active = buildAgentRows(tasks, taskAttention, repoNames, liveLines, now).filter((row) =>
    ACTIVE_AGENT_STATES.includes(row.state),
  );

  const byRepo = new Map<number, AgentRow[]>();
  for (const row of active) {
    const list = byRepo.get(row.task.repoId);
    if (list) list.push(row);
    else byRepo.set(row.task.repoId, [row]);
  }

  const byWorkspace = new Map<number, AgentRow[]>();
  for (const workspace of workspaces) {
    const rows: AgentRow[] = [];
    for (const repoId of workspace.repoIds) {
      for (const row of byRepo.get(repoId) ?? []) rows.push(row);
    }
    byWorkspace.set(workspace.id, rows);
  }

  return { byRepo, byWorkspace };
}

/** The most urgent active state present in a row list, in priority order. */
export function dominantState(rows: AgentRow[]): AgentState | undefined {
  return ACTIVE_AGENT_STATES.find((state) => rows.some((row) => row.state === state));
}
