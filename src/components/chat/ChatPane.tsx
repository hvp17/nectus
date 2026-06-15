import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../queries/keys";
import { useAppStore } from "../../store/appStore";
import { useTaskChat } from "../../hooks/useTaskChat";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ChatTranscript } from "./ChatTranscript";

export interface ChatPaneProps {
  taskId: number;
  /** The task's agent profile — used to start an ACP session on first prompt. */
  agentProfileId?: number | null;
  /** Open a touched file (the stage switches to the diff tab). */
  onOpenFile?: (path: string) => void;
}

/**
 * The task chat surface. Reads the transcript (kept live by the `session_chat`
 * event bridge), drives the composer (start session on first prompt, then send),
 * and wires permission answers back to the running ACP session.
 */
export function ChatPane({ taskId, agentProfileId, onOpenFile }: ChatPaneProps) {
  const chat = useTaskChat(taskId);
  const queryClient = useQueryClient();
  const messages = chat.data?.messages ?? [];
  const sessionId = chat.data?.session?.id ?? null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const onRespondPermission = useCallback(
    (requestId: string, optionId: string) => {
      if (!sessionId) return;
      void api
        .acpRespondPermission(sessionId, requestId, optionId)
        .catch((error) => useAppStore.getState().setMessage(String(error)));
    },
    [sessionId],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      let id = sessionId;
      if (!id) {
        const session = await api.acpStartChat(taskId, agentProfileId ?? null);
        id = session.id;
        await queryClient.invalidateQueries({ queryKey: queryKeys.task.chat(taskId) });
      }
      try {
        await api.acpSendPrompt(id, text);
      } catch (error) {
        if (!sessionId || !isStaleChatSessionError(error)) throw error;
        const session = await api.acpStartChat(taskId, agentProfileId ?? null);
        id = session.id;
        await queryClient.invalidateQueries({ queryKey: queryKeys.task.chat(taskId) });
        await api.acpSendPrompt(id, text);
      }
      setDraft("");
    } catch (error) {
      useAppStore.getState().setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, sessionId, taskId, agentProfileId, queryClient]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-pane">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ChatTranscript
          messages={messages}
          onRespondPermission={onRespondPermission}
          onOpenFile={onOpenFile}
        />
      </div>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          className="min-h-9 flex-1 resize-none"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={sessionId ? "Message the agent… (⌘↵ to send)" : "Start a chat with the agent…"}
          data-testid="chat-composer-input"
        />
        <div className="flex shrink-0 flex-col gap-1">
          {sessionId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void api.acpStopChat(sessionId).catch(() => undefined)}
            >
              Stop
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || !draft.trim()} data-testid="chat-send">
            {sessionId ? "Send" : "Start"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function isStaleChatSessionError(error: unknown) {
  return String(error).includes("No such chat session");
}
