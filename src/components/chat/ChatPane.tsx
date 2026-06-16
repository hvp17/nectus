import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatStatus, FileUIPart } from "ai";
import { ImagePlus, SlidersHorizontal, Terminal } from "lucide-react";
import { useAcpProvidersQuery, useAgentProfilesQuery } from "@/queries/core";
import { queryKeys } from "@/queries/keys";
import { api } from "@/api";
import { useTaskChat } from "@/hooks/useTaskChat";
import { useAppStore } from "@/store/appStore";
import { AgentLogo } from "@/components/AgentBrand";
import {
  Checkpoint,
  CheckpointIcon,
  CheckpointTrigger,
} from "@/components/ai-elements/checkpoint";
import { Context, ContextContent, ContextContentHeader, ContextTrigger } from "@/components/ai-elements/context";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChatTranscript } from "./ChatTranscript";
import type { ChatAvailableCommand, ChatConfigOption, ChatImageAttachment, ChatSessionMode } from "@/types";

export interface ChatPaneProps {
  taskId: number;
  agentProfileId?: number | null;
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
  const chatHydrating = chat.isLoading || (chat.isFetching && chat.data == null);
  const [busy, setBusy] = useState(false);
  const selectedAgentProfile = agentProfiles.find((profile) => profile.id === selectedAgentProfileId);
  const selectedAcpProvider = acpProviders.find((provider) => provider.agentKind === selectedAgentProfile?.agentKind);
  const selectedProfileIdForStart = selectedAgentProfile?.id ?? selectedAgentProfileId;
  const activeSessionId = chatSession?.id ?? null;
  const runtime = chatSession?.runtime ?? null;
  const unsupportedAgent = Boolean(selectedAgentProfile && acpProvidersQuery.isSuccess && !selectedAcpProvider);
  const missingAgent = Boolean(agentProfilesQuery.isSuccess && !selectedAgentProfile);
  const supportsImages = runtime
    ? runtime.capabilities.prompt.image
    : selectedAcpProvider?.capabilities.images === "expected" ||
      selectedAcpProvider?.capabilities.images === "unknown";
  const supportsResume =
    Boolean(chatSession?.acpSessionId) &&
    (runtime ? runtime.capabilities.loadSession : selectedAcpProvider?.capabilities.sessionLoad !== "unsupported");
  const availableCommands = runtime?.availableCommands ?? [];
  const modes = runtime?.modes ?? [];
  const configOptions = runtime?.configOptions ?? [];
  const sessionTitle = runtime?.title?.trim();
  const agentWorking = messages.some(
    (message) => message.role === "agent" && message.completedAt == null && !message.id.startsWith("perm-"),
  );

  const usageQuery = useQuery<ChatUsageSnapshot | null>({
    queryKey: queryKeys.task.chatUsage(taskId, selectedAgentProfileId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
  });

  const checkpointsQuery = useQuery({
    queryKey: queryKeys.task.chatCheckpoints(activeSessionId ?? ""),
    queryFn: () => api.listChatCheckpoints(activeSessionId!),
    enabled: activeSessionId != null,
  });
  const checkpoints = checkpointsQuery.data ?? [];

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

  const onSetMode = useCallback(
    (modeId: string) => {
      if (!activeSessionId) return;
      void api
        .acpSetSessionMode(activeSessionId, modeId)
        .catch((error) => useAppStore.getState().setMessage(String(error)));
    },
    [activeSessionId],
  );

  const onSetConfigOption = useCallback(
    (configId: string, valueId: string) => {
      if (!activeSessionId) return;
      void api
        .acpSetConfigOption(activeSessionId, configId, valueId)
        .catch((error) => useAppStore.getState().setMessage(String(error)));
    },
    [activeSessionId],
  );

  const send = useCallback(
    async (text: string, images: ChatImageAttachment[]) => {
      const trimmed = text.trim();
      if (!trimmed || busy || chatHydrating || unsupportedAgent || missingAgent || selectedProfileIdForStart == null) return;
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
          await api.acpSendPrompt(id, trimmed, images.length > 0 ? images : undefined);
        } catch (error) {
          if (!isStaleChatSessionError(error)) throw error;
          id = await startChat();
          await api.acpSendPrompt(id, trimmed, images.length > 0 ? images : undefined);
        }
        if (id) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.task.chatCheckpoints(id) });
        }
      } catch (error) {
        useAppStore.getState().setMessage(String(error));
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      chatHydrating,
      unsupportedAgent,
      missingAgent,
      activeSessionId,
      taskId,
      selectedProfileIdForStart,
      queryClient,
    ],
  );

  const composerDisabled = unsupportedAgent || missingAgent || chatHydrating;
  const promptStatus: ChatStatus | undefined = busy
    ? "submitted"
    : agentWorking
      ? "streaming"
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="chat-pane">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1">
        <ChatTranscript
          messages={messages}
          onOpenFile={onOpenFile}
          onRespondPermission={onRespondPermission}
        />
      </div>
      {unsupportedAgent && (
        <div className="border-t p-2">
          <Alert>
            <AlertTitle>ACP chat unavailable</AlertTitle>
            <AlertDescription>
              {selectedAgentProfile?.name} does not have an ACP provider descriptor yet.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <PromptInputProvider>
      <div className="flex flex-wrap items-center gap-2 border-t px-2 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Chat agent</span>
        <Select
          disabled={agentProfiles.length === 0}
          value={selectedAgentProfileId?.toString()}
          onValueChange={(value) => setSelectedAgentProfileId(Number(value))}
        >
          <SelectTrigger aria-label="Chat agent" className="h-7 w-[220px]">
            <SelectValue placeholder="Choose an agent" />
          </SelectTrigger>
          <SelectContent>
            {agentProfiles.map((profile) => {
              const provider = providerForProfile(profile.agentKind);
              const unsupported = acpProvidersQuery.isSuccess && !provider;
              return (
                <SelectItem key={profile.id} disabled={unsupported} value={profile.id.toString()}>
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentLogo agentKind={profile.agentKind} size="sm" />
                    <span className="truncate">{profile.name}</span>
                    {unsupported && <span className="text-muted-foreground">No ACP</span>}
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
              <Badge className="h-5 px-1.5 text-[10px] capitalize" variant="outline">
                {selectedAcpProvider.maturity}
              </Badge>
            )}
          </span>
        )}
        {sessionTitle && (
          <Badge className="h-5 max-w-[220px] truncate px-1.5 text-[10px]" data-testid="chat-session-title" variant="outline">
            {sessionTitle}
          </Badge>
        )}
        {supportsResume && (
          <Badge className="h-5 px-1.5 text-[10px]" data-testid="chat-resume-badge" variant="secondary">
            Resumable
          </Badge>
        )}
        {agentWorking && (
          <Badge className="h-5 px-1.5 text-[10px] text-status-info" variant="outline">
            Agent working…
          </Badge>
        )}
        {usageQuery.data && usageQuery.data.size > 0 && (
          <Context maxTokens={usageQuery.data.size} usedTokens={usageQuery.data.used}>
            <ContextTrigger className="h-7 px-2 text-xs" data-testid="chat-usage" />
            <ContextContent>
              <ContextContentHeader />
            </ContextContent>
          </Context>
        )}
        {activeSessionId && checkpoints.length > 0 && (
          <Checkpoint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <CheckpointTrigger className="h-7 gap-1 px-2 text-xs" tooltip="Restore a git checkpoint">
                  <CheckpointIcon className="size-3.5" />
                  Checkpoints
                </CheckpointTrigger>
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
          </Checkpoint>
        )}
        <ChatCommandMenu commands={availableCommands} disabled={composerDisabled || !activeSessionId} />
        <ChatModeSelect
          activeSessionId={activeSessionId}
          currentModeId={runtime?.currentModeId ?? null}
          disabled={composerDisabled}
          modes={modes}
          onSetMode={onSetMode}
        />
        <ChatConfigControls
          activeSessionId={activeSessionId}
          configOptions={configOptions}
          disabled={composerDisabled}
          onSetConfigOption={onSetConfigOption}
        />
      </div>
      <PromptInput
        accept={supportsImages ? "image/*" : undefined}
        className="border-t p-2"
        multiple
        onSubmit={(message) => {
          void send(message.text, filePartsToImages(message.files));
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            data-testid="chat-composer-input"
            disabled={composerDisabled}
            name="message"
            placeholder={
              unsupportedAgent
                ? "ACP chat is unavailable for this agent"
                : activeSessionId
                  ? "Message the agent…"
                  : "Start a chat with the agent…"
            }
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {supportsImages && !composerDisabled && <ChatAttachImageButton />}
          </PromptInputTools>
          <PromptInputSubmit
            data-testid="chat-send"
            disabled={composerDisabled || busy}
            onStop={
              activeSessionId
                ? () => void api.acpCancelPrompt(activeSessionId).catch(() => undefined)
                : undefined
            }
            status={promptStatus}
          />
        </PromptInputFooter>
      </PromptInput>
      </PromptInputProvider>
    </div>
  );
}

function ChatCommandMenu({
  commands,
  disabled,
}: {
  commands: ChatAvailableCommand[];
  disabled: boolean;
}) {
  const { textInput } = usePromptInputController();
  if (commands.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-7 gap-1.5 px-2 text-xs"
          data-testid="chat-command-menu"
          disabled={disabled}
          size="sm"
          variant="outline"
        >
          <Terminal className="size-3.5" aria-hidden="true" />
          Commands
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {commands.map((command) => (
          <DropdownMenuItem
            key={command.name}
            onSelect={(event) => {
              event.preventDefault();
              textInput.setInput(`/${command.name}${command.inputHint ? " " : ""}`);
            }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs">/{command.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {command.inputHint ?? command.description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChatModeSelect({
  activeSessionId,
  currentModeId,
  disabled,
  modes,
  onSetMode,
}: {
  activeSessionId: string | null;
  currentModeId: string | null;
  disabled: boolean;
  modes: ChatSessionMode[];
  onSetMode: (modeId: string) => void;
}) {
  if (!activeSessionId || modes.length === 0) return null;
  return (
    <Select disabled={disabled} value={currentModeId ?? undefined} onValueChange={onSetMode}>
      <SelectTrigger aria-label="Session mode" className="h-7 w-[132px]">
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {modes.map((mode) => (
          <SelectItem key={mode.id} value={mode.id}>
            {mode.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChatConfigControls({
  activeSessionId,
  configOptions,
  disabled,
  onSetConfigOption,
}: {
  activeSessionId: string | null;
  configOptions: ChatConfigOption[];
  disabled: boolean;
  onSetConfigOption: (configId: string, valueId: string) => void;
}) {
  if (!activeSessionId || configOptions.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {configOptions.map((option) => {
        if (option.options.length === 0) return null;
        return (
          <Select
            key={option.id}
            disabled={disabled}
            value={option.currentValue ?? undefined}
            onValueChange={(value) => onSetConfigOption(option.id, value)}
          >
            <SelectTrigger aria-label={`Session config ${option.name}`} className="h-7 w-[132px]">
              <SlidersHorizontal className="mr-1.5 size-3.5" aria-hidden="true" />
              <SelectValue placeholder={option.name} />
            </SelectTrigger>
            <SelectContent>
              {option.options.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}
    </span>
  );
}

function ChatAttachImageButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton aria-label="Attach image" onClick={() => attachments.openFileDialog()}>
      <ImagePlus className="size-4" aria-hidden="true" />
    </PromptInputButton>
  );
}

function isStaleChatSessionError(error: unknown) {
  return String(error).includes("No such chat session");
}

function filePartsToImages(files: FileUIPart[]): ChatImageAttachment[] {
  const images: ChatImageAttachment[] = [];
  for (const file of files) {
    const mediaType = file.mediaType ?? "";
    if (!mediaType.startsWith("image/")) continue;
    const url = file.url;
    if (!url) continue;
    if (!url.startsWith("data:")) continue;
    const comma = url.indexOf(",");
    images.push({
      mimeType: mediaType,
      data: comma >= 0 ? url.slice(comma + 1) : url,
    });
  }
  return images;
}
