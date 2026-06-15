import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { isAcpCapableAgent } from "../lib/acpAgent";
import { clearTaskAttention, type TaskAttention } from "../sessionAttention";
import {
  closePrPrompt,
  createPrPrompt,
  markReadyPrompt,
  mergePrPrompt,
  type PrRepoScope,
} from "../lib/githubAgentPrompts";
import type { ChatTranscript, MergeMethod, TaskSummary } from "../types";

const NO_SESSION_MESSAGE = "Start or resume the agent for this task to ship from here.";

interface UseGithubShipActionsInput {
  setMessage: (message: string | null) => void;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
  /** Target a non-primary member repo of a cross-repo task (null → primary). */
  repoScope?: PrRepoScope | null;
}

/**
 * The four GitHub ship actions. ACP-capable agents receive prompts through the
 * chat runtime (`acp_send_prompt`); custom/terminal-only agents still submit
 * into the embedded PTY via `submit_session_input`.
 */
export function useGithubShipActions({
  setMessage,
  setTaskAttention,
  repoScope,
}: UseGithubShipActionsInput) {
  const queryClient = useQueryClient();
  const [creatingPullRequest, setCreatingPullRequest] = useState(false);
  const [pullRequestBusy, setPullRequestBusy] = useState(false);

  const resolveAcpSessionId = useCallback(
    async (task: TaskSummary): Promise<string> => {
      const cached = queryClient.getQueryData<ChatTranscript>(
        queryKeys.task.chat(task.id, task.agentProfileId ?? null),
      );
      if (cached?.session?.id) return cached.session.id;
      const session = await api.acpStartChat(task.id, task.agentProfileId ?? null);
      return session.id;
    },
    [queryClient],
  );

  const dispatch = useCallback(
    async (task: TaskSummary, prompt: string, working: string, setBusy: (busy: boolean) => void) => {
      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      setBusy(true);
      try {
        const providers = await api.listAcpProviders();
        if (isAcpCapableAgent(task.agentKind ?? "custom", providers)) {
          const sessionId = await resolveAcpSessionId(task);
          await api.acpSendPrompt(sessionId, prompt);
          setMessage(working);
          return;
        }
        if (!task.activeSessionId) {
          setMessage(NO_SESSION_MESSAGE);
          return;
        }
        await api.submitSessionInput(task.activeSessionId, prompt);
        setMessage(working);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setBusy(false);
      }
    },
    [resolveAcpSessionId, setMessage, setTaskAttention],
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
