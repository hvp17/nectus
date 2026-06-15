import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../queries/keys";
import { useAcpProvidersQuery, useAgentProfilesQuery } from "../../queries/core";
import { useAppStore } from "../../store/appStore";
import { useTaskChat } from "../../hooks/useTaskChat";
import { AgentLogo } from "../AgentBrand";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
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
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | null>(agentProfileId ?? null);
  const chat = useTaskChat(taskId, selectedAgentProfileId);
  const agentProfilesQuery = useAgentProfilesQuery();
  const agentProfiles = agentProfilesQuery.data ?? [];
  const acpProvidersQuery = useAcpProvidersQuery();
  const acpProviders = acpProvidersQuery.data ?? [];
  const queryClient = useQueryClient();
  const messages = chat.data?.messages ?? [];
  const chatSession = chat.data?.session ?? null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedAgentProfile = agentProfiles.find((profile) => profile.id === selectedAgentProfileId);
  const selectedAcpProvider = acpProviders.find((provider) => provider.agentKind === selectedAgentProfile?.agentKind);
  const selectedProfileIdForStart = selectedAgentProfile?.id ?? selectedAgentProfileId;
  const activeSessionId = chatSession?.id ?? null;
  const unsupportedAgent = Boolean(selectedAgentProfile && acpProvidersQuery.isSuccess && !selectedAcpProvider);
  const missingAgent = Boolean(agentProfilesQuery.isSuccess && !selectedAgentProfile);

  useEffect(() => {
    setSelectedAgentProfileId(agentProfileId ?? null);
  }, [agentProfileId, taskId]);

  const providerForProfile = useCallback(
    (profileAgentKind: string) => acpProviders.find((provider) => provider.agentKind === profileAgentKind),
    [acpProviders],
  );

  const onRespondPermission = useCallback(
    (requestId: string, optionId: string) => {
      if (!activeSessionId) return;
      void api
        .acpRespondPermission(activeSessionId, requestId, optionId)
        .catch((error) => useAppStore.getState().setMessage(String(error)));
    },
    [activeSessionId],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || unsupportedAgent || missingAgent || selectedProfileIdForStart == null) return;
    setBusy(true);
    try {
      const startChat = async () => {
        const session = await api.acpStartChat(taskId, selectedProfileIdForStart);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.task.chat(taskId, selectedProfileIdForStart),
        });
        return session.id;
      };

      let id = activeSessionId;
      if (!id) {
        id = await startChat();
      }
      try {
        await api.acpSendPrompt(id, text);
      } catch (error) {
        if (!isStaleChatSessionError(error)) throw error;
        id = await startChat();
        await api.acpSendPrompt(id, text);
      }
      setDraft("");
    } catch (error) {
      useAppStore.getState().setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [
    draft,
    busy,
    unsupportedAgent,
    missingAgent,
    activeSessionId,
    taskId,
    selectedProfileIdForStart,
    queryClient,
  ]);

  const composerDisabled = unsupportedAgent || missingAgent;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-pane">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ChatTranscript
          messages={messages}
          onRespondPermission={onRespondPermission}
          onOpenFile={onOpenFile}
        />
      </div>
      {unsupportedAgent && (
        <div className="border-t p-2">
          <Alert>
            <AlertTitle>ACP chat unavailable</AlertTitle>
            <AlertDescription>
              {selectedAgentProfile?.name} does not have an ACP provider descriptor yet. Use Terminal for this task.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Chat agent</span>
        <Select
          value={selectedAgentProfileId?.toString()}
          onValueChange={(value) => setSelectedAgentProfileId(Number(value))}
          disabled={agentProfiles.length === 0}
        >
          <SelectTrigger aria-label="Chat agent" className="h-7 w-[220px]">
            <SelectValue placeholder="Choose an agent" />
          </SelectTrigger>
          <SelectContent>
            {agentProfiles.map((profile) => {
              const provider = providerForProfile(profile.agentKind);
              const unsupported = acpProvidersQuery.isSuccess && !provider;
              return (
                <SelectItem key={profile.id} value={profile.id.toString()} disabled={unsupported}>
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentLogo agentKind={profile.agentKind} size="sm" />
                    <span className="truncate">{profile.name}</span>
                    {unsupported && <span className="text-muted-foreground">Terminal only</span>}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedAcpProvider && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{selectedAcpProvider.displayName} ACP</span>
            {selectedAcpProvider.maturity !== "stable" && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">
                {selectedAcpProvider.maturity}
              </Badge>
            )}
          </span>
        )}
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
          disabled={composerDisabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={
            unsupportedAgent
              ? "ACP chat is unavailable for this agent"
              : activeSessionId
                ? "Message the agent… (⌘↵ to send)"
                : "Start a chat with the agent…"
          }
          data-testid="chat-composer-input"
        />
        <div className="flex shrink-0 flex-col gap-1">
          {activeSessionId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void api.acpStopChat(activeSessionId).catch(() => undefined)}
            >
              Stop
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={busy || composerDisabled || !draft.trim()}
            data-testid="chat-send"
          >
            {activeSessionId ? "Send" : "Start"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function isStaleChatSessionError(error: unknown) {
  return String(error).includes("No such chat session");
}
