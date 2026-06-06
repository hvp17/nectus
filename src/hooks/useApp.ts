import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api";
import { replaceById, upsertById } from "../lib/listState";
import { jiraBrowseUrl } from "../lib/jira";
import { isReviewLoopActive } from "../statusLabels";
import { isBrowserPreview, seedAttention, seedLiveLines } from "../lib/browserSeed";
import { useGuardedAction } from "./useGuardedAction";
import {
  clearTaskAttention,
  getAttentionCounts,
  getTaskAttention,
  type TaskAttention,
} from "../sessionAttention";
import { useCreateTaskForm } from "./useCreateTaskForm";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionEvents } from "./useSessionEvents";
import type { TaskToast } from "../taskNotification";
import { useSessionAttentionControls } from "./useSessionAttentionControls";
import { useGithub } from "./useGithub";
import { useJiraBoardView } from "./useJiraBoardView";
import { useTaskDeletion } from "./useTaskDeletion";
import { useTaskReviewLoop } from "./useTaskReviewLoop";
import { usePrReviews } from "./usePrReviews";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  JiraWorkItem,
  Repo,
  ReviewLoop,
  TaskStatus,
  TaskSummary,
  Workspace,
} from "../types";

const CREATE_PULL_REQUEST_PROMPT = `Create a pull request for this task. Use the current project/worktree branch. Before opening the PR, verify the work as appropriate for this repo, commit relevant changes with a Conventional Commit if needed, push the branch, create the PR against the remote default branch, and report the PR URL here.`;

export function useApp() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | undefined>();
  // Repos chosen for a cross-repo task in the composer (Increment B). Primary first.
  const [newTaskRepoIds, setNewTaskRepoIds] = useState<number[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [currentView, setCurrentView] = useState<"mission" | "board" | "settings" | "reviews" | "jira">(
    "mission",
  );
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [taskAttention, setTaskAttention] = useState<TaskAttention[]>(() =>
    isBrowserPreview ? seedAttention : [],
  );
  const [liveLines, setLiveLines] = useState<Record<number, string>>(() =>
    isBrowserPreview ? seedLiveLines : {},
  );
  const [message, setMessage] = useState<string | null>(null);
  const [taskToast, setTaskToast] = useState<TaskToast | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingTaskIds, setDeletingTaskIds] = useState<ReadonlySet<number>>(() => new Set());
  const taskForm = useCreateTaskForm(settings?.defaultAgentProfileId ?? selectedAgentProfileId);
  const {
    createTaskOpen,
    setCreateTaskOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPrompt,
    setNewTaskPrompt,
    newTaskBranchName,
    setNewTaskBranchName,
    newTaskHasWorktree,
    setNewTaskHasWorktree,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    newTaskRepoId,
    setNewTaskRepoId,
    pendingJiraLink,
    setPendingJiraLink,
    resetCreateTaskForm,
    closeCreateTaskModal,
    getGeneratedTaskTitle,
    getSuggestedBranchName,
    resolveWorktreeBranchName,
  } = taskForm;

  const run = useGuardedAction(setMessage, setBusy);

  const selectedRepoIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);
  const activeWorkspaceIdRef = useRef<number | undefined>(undefined);
  const tasksRef = useRef<TaskSummary[]>([]);
  const deletingTaskIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const setTaskDeleting = useCallback((taskId: number, deleting: boolean) => {
    const next = new Set(deletingTaskIdsRef.current);
    if (deleting) {
      next.add(taskId);
    } else {
      next.delete(taskId);
    }
    deletingTaskIdsRef.current = next;
    setDeletingTaskIds(next);
  }, []);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);

  // The active workspace acts as a repo-scope filter (Increment A). When none is
  // active, behavior is unchanged (all repos). `undefined` means "All repos".
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  const workspaceRepoIds = useMemo(
    () => (activeWorkspace ? new Set(activeWorkspace.repoIds) : undefined),
    [activeWorkspace],
  );
  // The repo list the rail/board shows, narrowed to the active workspace.
  const scopedRepos = useMemo(
    () => (workspaceRepoIds ? repos.filter((repo) => workspaceRepoIds.has(repo.id)) : repos),
    [repos, workspaceRepoIds],
  );
  // The active workspace's repos, offered as a multi-select in the composer so a
  // task can span several of them (cross-repo). Empty when no workspace is active.
  const activeWorkspaceRepos = useMemo(
    () => (activeWorkspace ? scopedRepos : []),
    [activeWorkspace, scopedRepos],
  );
  // Cross-project (Mission Control) tasks, narrowed to the active workspace.
  const missionTasks = useMemo(
    () => (workspaceRepoIds ? tasks.filter((task) => workspaceRepoIds.has(task.repoId)) : tasks),
    [tasks, workspaceRepoIds],
  );

  // Keep the board's selected repo inside the active workspace, so switching
  // workspace can't leave a now-out-of-scope project selected.
  useEffect(() => {
    if (!workspaceRepoIds || (selectedRepoId && workspaceRepoIds.has(selectedRepoId))) return;
    const nextRepoId = scopedRepos[0]?.id;
    selectedRepoIdRef.current = nextRepoId;
    setSelectedRepoId(nextRepoId);
  }, [workspaceRepoIds, selectedRepoId, scopedRepos]);

  const visibleTasks = useMemo(() => {
    const scoped = workspaceRepoIds ? tasks.filter((task) => workspaceRepoIds.has(task.repoId)) : tasks;
    return selectedRepoId ? scoped.filter((task) => task.repoId === selectedRepoId) : scoped;
  }, [tasks, selectedRepoId, workspaceRepoIds]);
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [tasks, selectedTaskId]);

  const counts = useMemo(() => {
    const attentionCounts = getAttentionCounts(taskAttention);
    return {
      active: tasks.filter((task) => task.activeSessionId).length,
      dirty: tasks.filter((task) => task.isDirty).length,
      review: tasks.filter((task) => task.status === "review").length,
      needsInput: attentionCounts.needsInput,
      finished: attentionCounts.finished,
    };
  }, [taskAttention, tasks]);

  const refresh = useCallback(async (preferredRepoId?: number) => {
    setLoading(true);
    try {
      const [repoResult, workspaceResult, profileResult, settingsResult] = await Promise.all([
        api.listRepos(),
        api.listWorkspaces(),
        api.listAgentProfiles(),
        api.getAppSettings(),
      ]);
      setRepos(repoResult);
      setWorkspaces(workspaceResult);
      setAgentProfiles(profileResult);
      setSettings(settingsResult);

      // Drop the active-workspace filter if that workspace was deleted elsewhere,
      // so the rail/Mission Control don't filter against a phantom id.
      if (
        activeWorkspaceIdRef.current &&
        !workspaceResult.some((workspace) => workspace.id === activeWorkspaceIdRef.current)
      ) {
        activeWorkspaceIdRef.current = undefined;
        setActiveWorkspaceId(undefined);
      }

      const nextAgentProfileId =
        selectedAgentProfileIdRef.current ?? settingsResult.defaultAgentProfileId ?? profileResult[0]?.id;
      if (!selectedAgentProfileIdRef.current && nextAgentProfileId) {
        selectedAgentProfileIdRef.current = nextAgentProfileId;
        setSelectedAgentProfileId(nextAgentProfileId);
      }

      const nextRepoId = preferredRepoId ?? selectedRepoIdRef.current ?? repoResult[0]?.id;
      selectedRepoIdRef.current = nextRepoId;
      setSelectedRepoId(nextRepoId);

      const taskResult = await api.listTasks();
      setTasks(taskResult);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyReviewLoopToTask = useCallback((reviewLoop: ReviewLoop) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === reviewLoop.taskId
          ? {
              ...task,
              status: reviewLoop.status === "passed" ? "done" : task.status,
              reviewLoopStatus: reviewLoop.status,
            }
          : task,
      ),
    );
  }, []);

  const {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    setSelectedReviewRuns,
    liveReviewOutput,
  } = useTaskReviewLoop({
    selectedTaskId,
    onMessage: setMessage,
    onReviewLoopUpdated: applyReviewLoopToTask,
  });

  useEffect(() => {
    if (selectedReviewLoop) {
      applyReviewLoopToTask(selectedReviewLoop);
    }
  }, [applyReviewLoopToTask, selectedReviewLoop]);

  useSessionEvents({ tasksRef, setTasks, setMessage, setTaskToast, setTaskAttention, setLiveLines });

  const sessionCommands = useSessionCommands({
    agentProfiles,
    selectedAgentProfileId,
    setMessage,
    setSelectedTaskId,
    setTasks,
  });

  const { startSession, resumeSession, stopSession, onSessionExit, onSessionInput } =
    useSessionAttentionControls({
      tasksRef,
      setTaskAttention,
      sessionCommands,
    });

  const applyTask = useCallback((updated: TaskSummary) => {
    setTasks((current) => replaceById(current, updated));
  }, []);

  const {
    githubStatus,
    ghReady: githubReady,
    pullRequest: selectedPullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    createPullRequest: createGithubPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
  } = useGithub({ selectedTask, setMessage, applyTask });

  const jiraBoard = useJiraBoardView({
    active: currentView === "jira",
    settings,
    setSettings,
    setMessage,
  });
  const { jira, setSelectedItem: setSelectedJiraItem } = jiraBoard;

  const createTaskFromStory = useCallback(
    async (item: JiraWorkItem) => {
      setNewTaskTitle(item.summary);
      let description = item.description ?? "";
      if (!description) {
        try {
          description = (await api.jiraGetWorkItem(item.key)).description ?? "";
        } catch {
          // Best-effort: leave the prompt blank if the description fetch fails.
        }
      }
      setNewTaskPrompt(description);
      setPendingJiraLink({
        key: item.key,
        summary: item.summary,
        url: jiraBrowseUrl(jira.jiraStatus?.site, item.key),
      });
      setNewTaskRepoId(selectedRepoId ?? repos[0]?.id);
      setSelectedJiraItem(null);
      setCurrentView("board");
      setSelectedTaskId(undefined);
      setCreateTaskOpen(true);
    },
    [
      repos,
      selectedRepoId,
      jira.jiraStatus?.site,
      setSelectedJiraItem,
      setNewTaskTitle,
      setNewTaskPrompt,
      setPendingJiraLink,
      setNewTaskRepoId,
      setCreateTaskOpen,
    ],
  );

  const setTaskJiraLink = (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) =>
    run(async () => {
      const updated = await api.setTaskJiraLink({
        taskId,
        key: link?.key ?? null,
        summary: link?.summary ?? null,
        url: link?.url ?? null,
      });
      setTasks((current) => replaceById(current, updated));
    });

  const createPullRequest = useCallback(
    async (task: TaskSummary, options?: { draft?: boolean }) => {
      // Prefer a deterministic gh-driven PR for worktree tasks — no agent needed.
      if (task.hasWorktree && githubReady) {
        await createGithubPullRequest(task, { draft: options?.draft ?? false });
        return;
      }

      // Fallback: ask the running agent to open the PR from the terminal.
      if (!task.activeSessionId) {
        setMessage(
          "Start or resume the agent to open a PR, or connect the GitHub CLI for a worktree task.",
        );
        return;
      }

      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, task.id));

      try {
        await api.submitSessionInput(task.activeSessionId, CREATE_PULL_REQUEST_PROMPT);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [githubReady, createGithubPullRequest, setMessage, setTaskAttention],
  );

  const addProject = () =>
    run(
      async () => {
        const selected = await api.pickRepositoryFolder();
        if (!selected) return;
        const repo = await api.addRepo(selected);
        setSelectedRepoId(repo.id);
        await refresh(repo.id);
        setMessage(`Added ${repo.name}`);
      },
      { busy: true },
    );

  const createTask = async () => {
    // Workspace composer (Increment B): a workspace with ≥2 repos is active, so the
    // composer offered a repo checklist. The checklist is the source of truth, and
    // this gate keys on the SAME signal as the UI's cross-repo mode
    // (activeWorkspaceRepos.length >= 2) so they can't diverge. Routes by how many
    // repos were picked: ≥2 → cross-repo; exactly 1 → a single worktree task on
    // that repo (never the board-selected one).
    if (activeWorkspaceRepos.length >= 2 && newTaskRepoIds.length >= 1) {
      if (!newTaskAgentProfileId) {
        setMessage("Select an agent before creating a task.");
        return;
      }
      const agentProfileId = newTaskAgentProfileId;
      const repoIds = newTaskRepoIds;
      await run(
        async () => {
          const branchName = resolveWorktreeBranchName(
            newTaskBranchName,
            settings?.defaultBranchPrefix,
          );
          const task =
            repoIds.length >= 2
              ? await api.createCrossRepoTask({
                  workspaceId: activeWorkspaceId,
                  repoIds,
                  title: getGeneratedTaskTitle(),
                  prompt: newTaskPrompt.trim() || null,
                  agentProfileId,
                  branchName,
                })
              : await api.createTask({
                  repoId: repoIds[0],
                  title: getGeneratedTaskTitle(),
                  prompt: newTaskPrompt.trim() || null,
                  agentProfileId,
                  hasWorktree: true,
                  branchName,
                });
          resetCreateTaskForm();
          setNewTaskRepoIds([]);
          setCreateTaskOpen(false);
          setSelectedRepoId(repoIds[0]);
          setSelectedTaskId(task.id);
          let startError: string | null = null;
          try {
            await api.startSession(task.id, agentProfileId);
          } catch (error) {
            startError = String(error);
          }
          await refresh(repoIds[0]);
          if (startError) {
            setMessage(`Created ${task.title}, but failed to start session: ${startError}`);
          } else if (repoIds.length >= 2) {
            setMessage(`Created ${task.branchName} across ${repoIds.length} repos`);
          } else {
            setMessage(`Created ${task.branchName}`);
          }
        },
        { busy: true },
      );
      return;
    }

    const repoId = newTaskRepoId ?? selectedRepoId;
    if (!repoId) {
      setMessage("Choose a project before creating a task.");
      return;
    }
    if (!newTaskAgentProfileId) {
      setMessage("Select an agent before creating a task.");
      return;
    }
    const agentProfileId = newTaskAgentProfileId;
    const jiraLink = pendingJiraLink;
    await run(
      async () => {
        const branchName = newTaskHasWorktree
          ? resolveWorktreeBranchName(newTaskBranchName, settings?.defaultBranchPrefix)
          : null;
        const task = await api.createTask({
          repoId,
          title: getGeneratedTaskTitle(),
          prompt: newTaskPrompt.trim() || null,
          agentProfileId,
          hasWorktree: newTaskHasWorktree,
          branchName,
          jiraIssueKey: jiraLink?.key ?? null,
          jiraIssueSummary: jiraLink?.summary ?? null,
          jiraIssueUrl: jiraLink?.url ?? null,
        });
        resetCreateTaskForm();
        setNewTaskRepoIds([]);
        setCreateTaskOpen(false);
        setSelectedRepoId(repoId);
        setSelectedTaskId(task.id);
        let startError: string | null = null;
        try {
          await api.startSession(task.id, agentProfileId);
        } catch (error) {
          startError = String(error);
        }
        await refresh(repoId);
        if (startError) {
          setMessage(`Created ${task.title}, but failed to start session: ${startError}`);
        } else {
          setMessage(newTaskHasWorktree ? `Created ${task.branchName}` : `Created ${task.title}`);
        }
      },
      { busy: true },
    );
  };

  const updateStatus = (task: TaskSummary, status: TaskStatus) =>
    run(async () => {
      const updated = await api.updateTaskMetadata({ taskId: task.id, status });
      setTasks((current) => replaceById(current, updated));
      if (status === "done") {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
    });

  const startPairLoop = (task: TaskSummary, reviewerProfileId: number) =>
    run(async () => {
      const reviewLoop = await api.startPairLoop(task.id, reviewerProfileId);
      const reviewRuns = await api.listTaskReviewRuns(task.id);
      setSelectedReviewLoop(reviewLoop);
      setSelectedReviewRuns(reviewRuns);
      setMessage("Review: Started");
    });

  const startReview = (task: TaskSummary, reviewerProfileId: number) =>
    run(async () => {
      let reviewLoop = selectedReviewLoop;
      if (!reviewLoop || !isReviewLoopActive(reviewLoop.status)) {
        reviewLoop = await api.startPairLoop(task.id, reviewerProfileId);
      }
      const runningLoop = await api.runPairReview(task.id);
      const reviewRuns = await api.listTaskReviewRuns(task.id);
      const nextLoop = runningLoop ?? reviewLoop;
      setSelectedReviewLoop(
        nextLoop.status === "running" ? { ...nextLoop, status: "reviewing" } : nextLoop,
      );
      setSelectedReviewRuns(reviewRuns);
      setMessage("Review: Started");
    });

  const stopPairLoop = (task: TaskSummary) =>
    run(async () => {
      const reviewLoop = await api.stopPairLoop(task.id);
      setSelectedReviewLoop(reviewLoop);
      setMessage("Review: Stopped");
    });

  const requestDeleteTask = useTaskDeletion({
    deletingTaskIdsRef,
    setTaskDeleting,
    setTasks,
    setSelectedTaskId,
    setTaskAttention,
    setMessage,
  });

  const {
    prReviews,
    selectedPrReviewId,
    setSelectedPrReviewId,
    selectedPrReview,
    selectedPrReviewRuns,
    creatingReview,
    createPrReview,
    rerunPrReview,
    deletePrReview,
    postReviewComment,
  } = usePrReviews({ onMessage: setMessage });

  const saveAppSettings = (input: AppSettingsInput) =>
    run(
      async () => {
        const updated = await api.updateAppSettings(input);
        setSettings(updated);
        setSelectedAgentProfileId(updated.defaultAgentProfileId ?? undefined);
        selectedAgentProfileIdRef.current = updated.defaultAgentProfileId ?? undefined;
        setMessage("Settings saved");
        await refresh(selectedRepoIdRef.current);
        return updated;
      },
      { busy: true, rethrow: true },
    );

  const saveAgentProfile = (
    profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">,
  ) =>
    run(
      async () => {
        const saved = await api.upsertAgentProfile(profile);
        setAgentProfiles((current) => upsertById(current, saved));
        setMessage(`Saved ${saved.name}`);
        return saved;
      },
      { busy: true, rethrow: true },
    );

  const createWorkspace = (name: string, repoIds: number[]) =>
    run(
      async () => {
        const workspace = await api.createWorkspace(name, repoIds);
        await refresh(selectedRepoIdRef.current);
        setActiveWorkspaceId(workspace.id);
        activeWorkspaceIdRef.current = workspace.id;
        setMessage(`Workspace: Created ${workspace.name}`);
        return workspace;
      },
      { busy: true, rethrow: true },
    );

  const updateWorkspace = (id: number, name: string, repoIds: number[]) =>
    run(
      async () => {
        const workspace = await api.updateWorkspace(id, name, repoIds);
        await refresh(selectedRepoIdRef.current);
        setMessage(`Workspace: Saved ${workspace.name}`);
        return workspace;
      },
      { busy: true, rethrow: true },
    );

  const deleteWorkspace = (id: number) =>
    run(
      async () => {
        await api.deleteWorkspace(id);
        if (activeWorkspaceIdRef.current === id) {
          activeWorkspaceIdRef.current = undefined;
          setActiveWorkspaceId(undefined);
        }
        await refresh(selectedRepoIdRef.current);
        setMessage("Workspace: Deleted");
      },
      { busy: true, rethrow: true },
    );

  return {
    repos,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    activeWorkspaceRepos,
    scopedRepos,
    missionTasks,
    newTaskRepoIds,
    setNewTaskRepoIds,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    tasks,
    agentProfiles,
    settings,
    currentView,
    setCurrentView,
    selectedRepoId,
    setSelectedRepoId,
    selectedTaskId,
    setSelectedTaskId,
    selectedRepo,
    visibleTasks,
    selectedTask,
    selectedReviewLoop,
    selectedReviewRuns,
    liveReviewOutput,
    taskAttention,
    liveLines,
    selectedTaskAttention: selectedTask ? getTaskAttention(taskAttention, selectedTask.id) : undefined,
    counts,
    message,
    setMessage,
    taskToast,
    setTaskToast,
    busy,
    deletingTaskIds,
    loading,
    refresh,
    addProject,
    createTaskOpen,
    setCreateTaskOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPrompt,
    setNewTaskPrompt,
    newTaskBranchName,
    setNewTaskBranchName,
    newTaskHasWorktree,
    setNewTaskHasWorktree,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    newTaskRepoId,
    setNewTaskRepoId,
    pendingJiraLink,
    suggestedBranchName: getSuggestedBranchName(settings?.defaultBranchPrefix),
    createTask,
    createTaskFromStory,
    setTaskJiraLink,
    closeCreateTaskModal,
    updateStatus,
    requestDeleteTask,
    startSession,
    stopSession,
    resumeSession,
    createPullRequest,
    githubStatus,
    selectedPullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
    jiraStatus: jira.jiraStatus,
    jiraRestStatus: jira.restStatus,
    jiraRestConnected: jira.restConnected,
    jiraProjects: jira.projects,
    jiraProjectStatuses: jira.projectStatuses,
    jiraColumns: jira.columns,
    jiraLoading: jira.loading,
    refreshJira: jira.refresh,
    transitionJira: jira.transition,
    assignJira: jira.assign,
    commentJira: jira.comment,
    setJiraApiToken: jiraBoard.saveToken,
    clearJiraApiToken: jiraBoard.disconnect,
    setJiraBoardConfig: jiraBoard.setBoardConfig,
    selectedJiraItem: jiraBoard.selectedItem,
    setSelectedJiraItem,
    openJiraItem: jiraBoard.openItem,
    createJiraItemOpen: jiraBoard.createOpen,
    openCreateJiraItem: jiraBoard.openCreate,
    closeCreateJiraItem: jiraBoard.closeCreate,
    createJiraWorkItem: jiraBoard.createWorkItem,
    startPairLoop,
    startReview,
    stopPairLoop,
    onSessionExit,
    onSessionInput,
    selectedAgentProfileId,
    setSelectedAgentProfileId,
    saveAppSettings,
    saveAgentProfile,
    prReviews,
    selectedPrReviewId,
    setSelectedPrReviewId,
    selectedPrReview,
    selectedPrReviewRuns,
    creatingReview,
    createPrReview,
    rerunPrReview,
    deletePrReview,
    postReviewComment,
  };
}
