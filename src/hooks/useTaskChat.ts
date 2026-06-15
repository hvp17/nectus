import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import type { ChatTranscript } from "../types";

/**
 * Read a task's ACP chat transcript (the settled turns). The `session_chat`
 * channel in `useEventBridge` upserts streaming messages into this same cache
 * key, so the pane stays live without a separate store slice.
 */
export function useTaskChat(taskId: number, agentProfileId?: number | null) {
  return useQuery<ChatTranscript>({
    queryKey: queryKeys.task.chat(taskId, agentProfileId),
    queryFn: () => api.getTaskChat(taskId, agentProfileId),
    enabled: agentProfileId != null,
  });
}
