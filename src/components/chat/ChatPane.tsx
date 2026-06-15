import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, History } from "lucide-react";
import { api } from "../../api";
import { queryKeys } from "../../queries/keys";
import { useAcpProvidersQuery, useAgentProfilesQuery } from "../../queries/core";
import { useAppStore } from "../../store/appStore";
import { useTaskChat } from "../../hooks/useTaskChat";
import { AgentLogo } from "../AgentBrand";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { ChatTranscript } from "./ChatTranscript";
import type { ChatImageAttachment } from "../../types";

export interface ChatPaneProps {
  taskId: number;
  /** The task's agent profile — used to start an ACP session on first prompt. */
  agentProfileId?: number | null;
  /** Open a touched file (the stage switches to the diff tab). */
  onOpenFile?: (path: string) => void;
}

interface ChatUsageSnapshot {
  used: number;
  size: number;
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
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAgentProfile = agentProfiles.find((profile) => profile.id === selectedAgentProfileId);
  const selectedAcpProvider = acpProviders.find((provider) => provider.agentKind === selectedAgentProfile?.agentKind);
  const selectedProfileIdForStart = selectedAgentProfile?.id ?? selectedAgentProfileId;
  const activeSessionId = chatSession?.id ?? null;
  const unsupportedAgent = Boolean(selectedAgentProfile && acpProvidersQuery.isSuccess && !selectedAcpProvider);
  const missingAgent = Boolean(agentProfilesQuery.isSuccess && !selectedAgentProfile);
  const supportsImages =
    selectedAcpProvider?.capabilities.images === "expected" ||
    selectedAcpProvider?.capabilities.images === "unknown";
  const supportsResume =
    Boolean(chatSession?.acpSessionId) &&
    selectedAcpProvider?.capabilities.sessionLoad !== "unsupported";
  const agentWorking = messages.some(
    (message) => message.role === "agent" && message.completedAt == null && !message.id.startsWith("perm-"),
  );

  const usageQuery = useQuery<ChatUsageSnapshot | null>({
    queryKey: queryKeys.task.chatUsage(taskId, selectedAgentProfileId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });
  const usagePercent =
    usageQuery.data && usageQuery.data.size > 0
      ? Math.min(100, Math.round((usageQuery.data.used / usageQuery.data.size) * 100))
      : null;

  const checkpointsQuery = useQuery({
    queryKey: queryKeys.task.chatCheckpoints(activeSessionId ?? ""),
    queryFn: () => api.listChatCheckpoints(activeSessionId!),
    enabled: activeSessionId != null,
  });
  const checkpoints = checkpointsQuery.data ?? [];

  useEffect(() => {
    setSelectedAgentProfileId(agentProfileId ?? null);
  }, [agentProfileId, taskId]);

  useEffect(() => {
    setPendingImages([]);
  }, [selectedAgentProfileId, taskId]);

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

  const attachImages = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const next: ChatImageAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const data = await fileToBase64(file);
      next.push({ mimeType: file.type, data });
    }
    if (next.length > 0) {
      setPendingImages((current) => [...current, ...next]);
    }
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || unsupportedAgent || missingAgent || selectedProfileIdForStart == null) return;
    setBusy(true);
    const images = pendingImages;
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
        await api.acpSendPrompt(id, text, images.length > 0 ? images : undefined);
      } catch (error) {
        if (!isStaleChatSessionError(error)) throw error;
        id = await startChat();
        await api.acpSendPrompt(id, text, images.length > 0 ? images : undefined);
      }
      setDraft("");
      setPendingImages([]);
      if (id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.task.chatCheckpoints(id) });
      }
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
    pendingImages,
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
        {supportsResume && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]" data-testid="chat-resume-badge">
            Resumable
          </Badge>
        )}
        {agentWorking && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-status-info">
            Agent working…
          </Badge>
        )}
        {usagePercent != null && (
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="chat-usage">
            Context {usagePercent}%
          </span>
        )}
        {activeSessionId && checkpoints.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <History className="size-3.5" aria-hidden="true" />
                Checkpoints
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 w-72 overflow-auto">
              {[...checkpoints].reverse().map((checkpoint) => (
                <DropdownMenuItem
                  key={checkpoint.id}
                  onClick={() => {
                    void api
                      .restoreChatCheckpoint(checkpoint.id)
                      .then(() => useAppStore.getState().setMessage(`Restored: ${checkpoint.label}`))
                      .catch((error) => useAppStore.getState().setMessage(String(error)));
                  }}
                >
                  <span className="truncate">{checkpoint.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pendingImages.map((image, index) => (
                <Badge key={`${image.mimeType}-${index}`} variant="secondary" className="text-[10px]">
                  Image {index + 1}
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove image ${index + 1}`}
                    onClick={() =>
                      setPendingImages((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Textarea
            className="min-h-9 resize-none"
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
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void attachImages(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="flex shrink-0 flex-col gap-1">
          {supportsImages && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={composerDisabled}
              aria-label="Attach image"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
            </Button>
          )}
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read image"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}
