import { useEffect } from "react";
import { useReposQuery, useWorkspacesQuery, useAgentProfilesQuery, useSettingsQuery } from "../queries/core";
import { resolveAgentProfileId } from "../lib/agentProfiles";
import { useAppStore } from "../store/appStore";
import type { AgentProfile, Repo, Workspace } from "../types";

const EMPTY_REPOS: Repo[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_PROFILES: AgentProfile[] = [];

/**
 * Boot-time default selection, run once at the app root: pick the default agent and
 * repo as their data loads, and drop a focused workspace that was deleted elsewhere.
 * Reads the current selection via `useAppStore.getState()` (always fresh, no render
 * dependency), so the three effects are order-independent.
 */
export function useShellBootstrap() {
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const workspaces = useWorkspacesQuery().data ?? EMPTY_WORKSPACES;
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const settings = useSettingsQuery().data;
  const setSelectedRepoId = useAppStore((s) => s.setSelectedRepoId);
  const setSelectedAgentProfileId = useAppStore((s) => s.setSelectedAgentProfileId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    if (useAppStore.getState().selectedAgentProfileId !== undefined) return;
    const next = resolveAgentProfileId(agentProfiles, settings?.defaultAgentProfileId);
    if (next !== undefined) setSelectedAgentProfileId(next);
  }, [settings, agentProfiles, setSelectedAgentProfileId]);

  useEffect(() => {
    if (useAppStore.getState().selectedRepoId !== undefined) return;
    if (repos[0]) setSelectedRepoId(repos[0].id);
  }, [repos, setSelectedRepoId]);

  useEffect(() => {
    const activeId = useAppStore.getState().activeWorkspaceId;
    if (activeId && !workspaces.some((workspace) => workspace.id === activeId)) {
      setActiveWorkspaceId(undefined);
    }
  }, [workspaces, setActiveWorkspaceId]);
}
