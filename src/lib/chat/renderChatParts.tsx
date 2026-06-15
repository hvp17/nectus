import type { DynamicToolUIPart } from "ai";
import { Badge } from "@/components/ui/badge";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import { formatToolDisplayName } from "@/lib/chat/toolDisplayName";
import type {
  ChatMessage,
  ChatPart,
  ChatPlanStatus,
  ChatToolStatus,
} from "@/types";

/** Callbacks a transcript threads down to interactive parts. */
export interface ChatPartHandlers {
  onRespondPermission?: (requestId: string, optionId: string) => void;
  onOpenFile?: (path: string) => void;
}

const PLAN_STATUS_LABEL: Record<ChatPlanStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Done",
};

export function mapToolState(status: ChatToolStatus): DynamicToolUIPart["state"] {
  switch (status) {
    case "pending":
      return "input-streaming";
    case "running":
      return "input-available";
    case "completed":
      return "output-available";
    case "failed":
      return "output-error";
    default:
      return "input-streaming";
  }
}

function toolStatusLabel(status: ChatToolStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function renderChatPart({
  part,
  handlers,
  isStreaming,
  partKey,
}: {
  part: ChatPart;
  handlers?: ChatPartHandlers;
  isStreaming?: boolean;
  partKey: string;
}) {
  switch (part.type) {
    case "text":
      return (
        <div key={partKey} data-testid="chat-text">
          <MessageResponse isAnimating={isStreaming}>{part.text}</MessageResponse>
        </div>
      );
    case "reasoning":
      return (
        <Reasoning key={partKey} data-testid="chat-reasoning" defaultOpen={false} isStreaming={isStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "tool": {
      const state = mapToolState(part.status);
      const hasBody =
        part.locations.length > 0 || Boolean(part.output) || part.rawInput != null;
      const displayName = formatToolDisplayName(part.title, part.kind);
      return (
        <Tool key={partKey} data-status={part.status} data-testid="chat-tool" defaultOpen={false}>
          <ToolHeader
            compact
            expandable={hasBody}
            state={state}
            title={displayName}
            toolName={part.kind ?? "tool"}
            type="dynamic-tool"
          />
          <span className="sr-only" data-testid="chat-tool-status">
            {toolStatusLabel(part.status)}
          </span>
          {hasBody && (
            <ToolContent>
              {part.rawInput != null && <ToolInput input={part.rawInput} />}
              {part.locations.length > 0 && (
                <ul className="space-y-1 font-mono text-xs">
                  {part.locations.map((location, index) => (
                    <li key={`${location.path}-${index}`}>
                      {location.path}
                      {location.line != null ? `:${location.line}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {(part.output || part.status === "failed") && (
                <ToolOutput
                  errorText={part.status === "failed" ? part.output ?? "Tool failed" : undefined}
                  output={part.status === "failed" ? undefined : part.output ?? undefined}
                />
              )}
            </ToolContent>
          )}
        </Tool>
      );
    }
    case "file_edit":
      return (
        <button
          key={partKey}
          className={cn(
            "mb-2 flex w-full items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70",
          )}
          data-testid="chat-file-chip"
          type="button"
          onClick={() => handlers?.onOpenFile?.(part.path)}
        >
          <span className="truncate font-mono text-xs">{part.path}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums">
            <span className="text-status-success">+{part.additions}</span>{" "}
            <span className="text-destructive">-{part.deletions}</span>
          </span>
        </button>
      );
    case "permission":
      return (
        <Confirmation
          key={partKey}
          approval={{ id: part.requestId }}
          className="mb-2"
          data-testid="chat-permission"
          state="approval-requested"
        >
          <ConfirmationTitle>{part.title}</ConfirmationTitle>
          <ConfirmationRequest>
            <ConfirmationActions>
              {part.options.map((option) => (
                <ConfirmationAction
                  key={option.optionId}
                  variant={option.kind.startsWith("allow") ? "default" : "outline"}
                  onClick={() => handlers?.onRespondPermission?.(part.requestId, option.optionId)}
                >
                  {option.label}
                </ConfirmationAction>
              ))}
            </ConfirmationActions>
          </ConfirmationRequest>
        </Confirmation>
      );
    case "plan":
      return (
        <Plan key={partKey} className="mb-2" data-testid="chat-plan" defaultOpen>
          <PlanHeader>
            <PlanTitle>Plan</PlanTitle>
            <PlanAction>
              <PlanTrigger />
            </PlanAction>
          </PlanHeader>
          <PlanContent>
            <ul className="space-y-2">
              {part.entries.map((entry, index) => (
                <li
                  key={`${index}-${entry.content}`}
                  className="flex items-start gap-2 text-sm"
                  data-status={entry.status}
                >
                  <Badge className="shrink-0" variant="outline">
                    {PLAN_STATUS_LABEL[entry.status]}
                  </Badge>
                  <span>{entry.content}</span>
                </li>
              ))}
            </ul>
          </PlanContent>
        </Plan>
      );
    default:
      return null;
  }
}

export function chatMessageRole(message: ChatMessage): "user" | "assistant" {
  return message.role === "user" ? "user" : "assistant";
}

export function ChatMessageRow({
  message,
  handlers,
}: {
  message: ChatMessage;
  handlers?: ChatPartHandlers;
}) {
  const isStreaming = message.completedAt == null;
  return (
    <Message data-role={message.role} data-testid="chat-message" from={chatMessageRole(message)}>
      <MessageContent>
        {message.parts.map((part, index) =>
          renderChatPart({
            part,
            handlers,
            isStreaming: isStreaming && part.type === "text",
            partKey: `${message.id}-${index}`,
          }),
        )}
      </MessageContent>
    </Message>
  );
}
