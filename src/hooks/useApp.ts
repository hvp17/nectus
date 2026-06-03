import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api";
import { toSettingsInput } from "../components/settings/profileDrafts";
import { replaceById, upsertById } from "../lib/listState";
import { jiraBrowseUrl } from "../lib/jira";
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
import { useSessionAttentionControls } from "./useSessionAttentionControls";
import { useGithub } from "./useGithub";
import { useJira } from "./useJira";
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
} from "../types";

const CREATE_PULL_REQUEST_PROMPT = `Create a pull request for this task. Use the current project/worktree branch. Before opening the PR, verify the work as appropriate for this repo, commit relevant changes with a Conventional Commit if needed, push the branch, create the PR against the remote default branch, and report the PR URL here.`;

export function useApp() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [currentView, setCurrentView] = useState<"dashboard" | "settings" | "reviews" | "jira">(
    "dashboard",
  );
  const [selectedJiraItem, setSelectedJiraItem] = useState<JiraWorkItem | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [taskAttention, setTaskAttention] = useState<TaskAttention[]>([]);
  const [message, setMessage] = useState<string | null>(null);
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
  const tasksRef = useRef<TaskSummary[]>([]);
  const deletingTaskIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

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
  const visibleTasks = useMemo(() => {
    return selectedRepoId ? tasks.filter((task) => task.repoId === selectedRepoId) : tasks;
  }, [tasks, selectedRepoId]);
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
      const [repoResult, profileResult, settingsResult] = await Promise.all([
        api.listRepos(),
        api.listAgentProfiles(),
        api.getAppSettings(),
      ]);
      setRepos(repoResult);
      setAgentProfiles(profileResult);
      setSettings(settingsResult);

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

  const { selectedReviewLoop, setSelectedReviewLoop, selectedReviewRuns, setSelectedReviewRuns } = useTaskReviewLoop({
    selectedTaskId,
    onMessage: setMessage,
    onReviewLoopUpdated: applyReviewLoopToTask,
  });

  useEffect(() => {
    if (selectedReviewLoop) {
      applyReviewLoopToTask(selectedReviewLoop);
    }
  }, [applyReviewLoopToTask, selectedReviewLoop]);

  useSessionEvents({ tasksRef, setTasks, setMessage, setTaskAttention });

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
    refreshPullRequest,
    createPullRequest: createGithubPullRequest,
  } = useGithub({ selectedTask, setMessage, applyTask });

  const jira = useJira({
    active: currentView === "jira",
    configured: Boolean(settings?.jiraBoardProject),
    setMessage,
  });

  const setJiraBoardConfig = (partial: {
    project?: string | null;
    myIssues?: boolean;
    unresolved?: boolean;
    currentSprint?: boolean;
  }) =>
    run(async () => {
      if (!settings) return;
      const updated = await api.updateAppSettings({
        ...toSettingsInput(settings),
        jiraBoardProject:
          partial.project !== undefined ? partial.project : settings.jiraBoardProject ?? null,
        jiraFilterMyIssues: partial.myIssues ?? settings.jiraFilterMyIssues,
        jiraFilterUnresolved: partial.unresolved ?? settings.jiraFilterUnresolved,
        jiraFilterCurrentSprint: partial.currentSprint ?? settings.jiraFilterCurrentSprint,
      });
      setSettings(updated);
      await jira.refresh();
    });

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
      setCurrentView("dashboard");
      setSelectedTaskId(undefined);
      setCreateTaskOpen(true);
    },
    [
      repos,
      selectedRepoId,
      jira.jiraStatus?.site,
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

  const addProject = async () => {
    setMessage(null);

    try {
      const selected = await api.pickRepositoryFolder();
      if (selected) {
        setBusy(true);
        const repo = await api.addRepo(selected);
        setSelectedRepoId(repo.id);
        await refresh(repo.id);
        setMessage(`Added ${repo.name}`);
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const createTask = async () => {
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
      if (!reviewLoop || ["passed", "feedback_sent", "error", "stopped"].includes(reviewLoop.status)) {
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

  return {
    repos,
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
    taskAttention,
    selectedTaskAttention: selectedTask ? getTaskAttention(taskAttention, selectedTask.id) : undefined,
    counts,
    message,
    setMessage,
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
    refreshPullRequest,
    jiraStatus: jira.jiraStatus,
    jiraProjects: jira.projects,
    jiraColumns: jira.columns,
    jiraLoading: jira.loading,
    refreshJira: jira.refresh,
    transitionJira: jira.transition,
    assignJira: jira.assign,
    commentJira: jira.comment,
    setJiraBoardConfig,
    selectedJiraItem,
    setSelectedJiraItem,
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
  };
}
