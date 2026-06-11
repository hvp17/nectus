import { useCallback } from "react";
import { api } from "../api";
import { useReposQuery, useSettingsQuery, useRefreshData } from "../queries/core";
import { useJiraStatusQuery } from "../queries/jira";
import { useGuardedAction } from "./useGuardedAction";
import {
  getSuggestedWorktreeBranchName,
  resolveWorktreeBranchName as resolveBranch,
} from "../lib/composerForm";
import { useAppStore } from "../store/appStore";
import { jiraBrowseUrl } from "../lib/jira";
import type { JiraWorkItem, Repo, TaskSummary } from "../types";

const EMPTY_REPOS: Repo[] = [];

/** Derive a task title from the draft (trimmed title, else first prompt line). */
function generatedTitle(title: string, prompt: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  const firstPromptLine = prompt
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstPromptLine ? firstPromptLine.slice(0, 80) : "Untitled task";
}

/**
 * Owns the New Task composer: the store-backed draft, the create-task submit (single
 * / worktree / cross-repo routing), and "create from JIRA story". Reads the draft via
 * `getState()` at submit time so it always uses the latest form values. Self-
 * sufficient — any component (the overlay, the JIRA board) can call it.
 */
export function useComposer() {
  const settings = useSettingsQuery().data;
  const repos = useReposQuery().data ?? EMPTY_REPOS;
  const jiraStatus = useJiraStatusQuery().data;
  const setMessage = useAppStore((s) => s.setMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const run = useGuardedAction(setMessage, setBusy);
  const refresh = useRefreshData();

  const getSuggestedBranchName = useCallback(
    (defaultBranchPrefix?: string | null) =>
      getSuggestedWorktreeBranchName(defaultBranchPrefix, useAppStore.getState().newTaskBranchIdentifier),
    [],
  );

  const createTask = useCallback(async () => {
    const store = useAppStore.getState();
    const branchPrefix = settings?.defaultBranchPrefix;
    const title = generatedTitle(store.newTaskTitle, store.newTaskPrompt);
    const prompt = store.newTaskPrompt.trim() || null;
    const resolveBranchName = (branchName: string) =>
      resolveBranch(branchName, branchPrefix, store.newTaskBranchIdentifier);

    // Shared post-create choreography: start the new task's session (tolerating a
    // start failure), select it, refresh, and report. The composer stays open
    // showing live status until the agent is launched, then closes — so the user
    // sees what's happening (worktree fetch can take a few seconds per repo)
    // instead of a blank spinner. Both create paths differ only in which create
    // API they call, the repo they select, and the message.
    const finishCreate = async (
      task: TaskSummary,
      selectRepoId: number,
      agentProfileId: number,
      successMessage: string,
    ) => {
      store.setTaskCreationStatus("Starting agent…");
      let startError: string | null = null;
      try {
        await api.startSession(task.id, agentProfileId);
      } catch (error) {
        startError = String(error);
      }
      store.closeComposer();
      store.setSelectedRepoId(selectRepoId);
      store.setSelectedTaskId(task.id);
      await refresh();
      setMessage(
        startError
          ? `Created ${task.title}, but failed to start session: ${startError}`
          : successMessage,
      );
    };

    // Workspace mode: the composer offered a repo checklist (its picks are the source
    // of truth). ≥2 repos → cross-repo; exactly 1 → a worktree task on that repo.
    if (store.newTaskWorkspaceId != null && store.newTaskRepoIds.length >= 1) {
      if (!store.newTaskAgentProfileId) {
        setMessage("Select an agent before creating a task.");
        return;
      }
      const agentProfileId = store.newTaskAgentProfileId;
      const repoIds = store.newTaskRepoIds;
      const workspaceId = store.newTaskWorkspaceId;
      const jiraLink = store.pendingJiraLink;
      const crossRepo = repoIds.length >= 2;
      await run(
        async () => {
          try {
            const branchName = resolveBranchName(store.newTaskBranchName);
            store.setTaskCreationStatus(
              crossRepo
                ? `Setting up ${repoIds.length} worktrees (fetching latest)…`
                : "Setting up worktree (fetching latest)…",
            );
            // Both create APIs attach the linked JIRA story atomically, so a task
            // created from a story keeps its link regardless of scope.
            const jiraFields = {
              jiraIssueKey: jiraLink?.key ?? null,
              jiraIssueSummary: jiraLink?.summary ?? null,
              jiraIssueUrl: jiraLink?.url ?? null,
            };
            const task = crossRepo
              ? await api.createCrossRepoTask({
                  workspaceId,
                  repoIds,
                  title,
                  prompt,
                  agentProfileId,
                  branchName,
                  ...jiraFields,
                })
              : await api.createTask({
                  repoId: repoIds[0],
                  title,
                  prompt,
                  agentProfileId,
                  hasWorktree: true,
                  branchName,
                  ...jiraFields,
                });
            await finishCreate(
              task,
              repoIds[0],
              agentProfileId,
              crossRepo ? `Created ${task.branchName} across ${repoIds.length} repos` : `Created ${task.branchName}`,
            );
          } finally {
            store.setTaskCreationStatus(null);
          }
        },
        { busy: true },
      );
      return;
    }

    const repoId = store.newTaskRepoId ?? store.selectedRepoId;
    if (!repoId) {
      setMessage("Choose a project before creating a task.");
      return;
    }
    if (!store.newTaskAgentProfileId) {
      setMessage("Select an agent before creating a task.");
      return;
    }
    const agentProfileId = store.newTaskAgentProfileId;
    const jiraLink = store.pendingJiraLink;
    const hasWorktree = store.newTaskHasWorktree;
    await run(
      async () => {
        try {
          const branchName = hasWorktree ? resolveBranchName(store.newTaskBranchName) : null;
          store.setTaskCreationStatus(
            hasWorktree ? "Setting up worktree (fetching latest)…" : "Creating task…",
          );
          const task = await api.createTask({
            repoId,
            title,
            prompt,
            agentProfileId,
            hasWorktree,
            branchName,
            jiraIssueKey: jiraLink?.key ?? null,
            jiraIssueSummary: jiraLink?.summary ?? null,
            jiraIssueUrl: jiraLink?.url ?? null,
          });
          await finishCreate(task, repoId, agentProfileId, hasWorktree ? `Created ${task.branchName}` : `Created ${task.title}`);
        } finally {
          store.setTaskCreationStatus(null);
        }
      },
      { busy: true },
    );
  }, [settings?.defaultBranchPrefix, run, refresh, setMessage]);

  const createTaskFromStory = useCallback(
    async (item: JiraWorkItem, agentProfileId?: number) => {
      const store = useAppStore.getState();
      if (agentProfileId !== undefined) store.setNewTaskAgentProfileId(agentProfileId);
      store.setNewTaskTitle(item.summary);
      let description = item.description ?? "";
      if (!description) {
        try {
          description = (await api.jiraGetWorkItem(item.key)).description ?? "";
        } catch {
          // Best-effort: leave the prompt blank if the description fetch fails.
        }
      }
      store.setNewTaskPrompt(description);
      store.setPendingJiraLink({
        key: item.key,
        summary: item.summary,
        url: jiraBrowseUrl(jiraStatus?.site, item.key),
      });
      store.setNewTaskRepoId(store.selectedRepoId ?? repos[0]?.id);
      // A JIRA-seeded task is single-repo; open the composer in Project mode.
      store.setNewTaskWorkspaceId(undefined);
      store.setCurrentView("board");
      store.setSelectedTaskId(undefined);
      store.setCreateTaskOpen(true);
    },
    [jiraStatus?.site, repos],
  );

  return { createTask, createTaskFromStory, getSuggestedBranchName };
}
