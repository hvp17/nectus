import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../api";
import { clearTaskAttention, type TaskAttention } from "../sessionAttention";
import {
  closePrPrompt,
  createPrPrompt,
  markReadyPrompt,
  mergePrPrompt,
  type PrRepoScope,
} from "../lib/githubAgentPrompts";
import type { MergeMethod, TaskSummary } from "../types";

const NO_SESSION_MESSAGE = "Start or resume the agent for this task to ship from here.";

interface UseGithubShipActionsInput {
  setMessage: (message: string | null) => void;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
  /** Target a non-primary member repo of a cross-repo task (null → primary). */
  repoScope?: PrRepoScope | null;
}

/**
 * The four GitHub ship actions, reworked to drive the task's running agent
 * session instead of calling `gh` directly: each submits a prompt (built in
 * `githubAgentPrompts`) into `task.activeSessionId` via `submit_session_input`,
 * so the agent authors the PR body and handles pushes/conflicts/rebases itself.
 * With no running session the action declines with guidance. The returned shapes
 * match the `on*PullRequest` props `GitHubPanel`/`PullRequestActions` already
 * expect, so the presentational layer is untouched.
 */
export function useGithubShipActions({
  setMessage,
  setTaskAttention,
  repoScope,
}: UseGithubShipActionsInput) {
  const [creatingPullRequest, setCreatingPullRequest] = useState(false);
  const [pullRequestBusy, setPullRequestBusy] = useState(false);

  const dispatch = useCallback(
    async (task: TaskSummary, prompt: string, working: string, setBusy: (busy: boolean) => void) => {
      if (!task.activeSessionId) {
        setMessage(NO_SESSION_MESSAGE);
        return;
      }
      const sessionId = task.activeSessionId;
      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      setBusy(true);
      try {
        await api.submitSessionInput(sessionId, prompt);
        setMessage(working);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setBusy(false);
      }
    },
    [setMessage, setTaskAttention],
  );

  const createPullRequest = useCallback(
    (task: TaskSummary, options?: { draft?: boolean }) =>
      dispatch(
        task,
        createPrPrompt({ draft: options?.draft ?? false, repoScope }),
        `Asked the agent to open a pull request for ${task.title}`,
        setCreatingPullRequest,
      ),
    [dispatch, repoScope],
  );

  const mergePullRequest = useCallback(
    (task: TaskSummary, method: MergeMethod) =>
      dispatch(
        task,
        mergePrPrompt(method, repoScope),
        `Asked the agent to merge the pull request for ${task.title}`,
        setPullRequestBusy,
      ),
    [dispatch, repoScope],
  );

  const setPullRequestReady = useCallback(
    (task: TaskSummary) =>
      dispatch(
        task,
        markReadyPrompt(repoScope),
        `Asked the agent to mark the pull request ready for ${task.title}`,
        setPullRequestBusy,
      ),
    [dispatch, repoScope],
  );

  const closePullRequest = useCallback(
    (task: TaskSummary) =>
      dispatch(
        task,
        closePrPrompt(repoScope),
        `Asked the agent to close the pull request for ${task.title}`,
        setPullRequestBusy,
      ),
    [dispatch, repoScope],
  );

  return {
    createPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
    creatingPullRequest,
    pullRequestBusy,
  };
}
