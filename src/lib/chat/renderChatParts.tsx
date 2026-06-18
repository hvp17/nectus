import type { DynamicToolUIPart } from "ai";
import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { CodeBlock } from "@/components/ai-elements/code-block";
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
import {
  groupToolParts,
  groupToolSummary,
  groupToolStatus,
  type RenderItem,
  type ToolPart as GroupToolPart,
} from "@/lib/chat/groupToolParts";
import {
  CommandStatusBadge,
  commandText,
  groupGlyph,
  toolGlyph,
} from "@/lib/chat/toolGlyph";
import type {
  ChatMessage,
  ChatPart,
  ChatPlanStatus,
  ChatToolStatus,
  ReviewVerdictLabel,
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

/** Verdict chip color per review verdict, for the inline subagent block header. */
const SUBAGENT_VERDICT_CLASS: Record<ReviewVerdictLabel, string> = {
  clean: "text-status-success",
  blockers: "text-destructive",
  feedback: "text-status-warning",
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
      const glyph = toolGlyph(part.kind, part.status);
      const cmd = part.kind === "execute" ? commandText(part.rawInput) : null;
      const hasBody =
        part.locations.length > 0 || Boolean(part.output) || part.rawInput != null;
      const displayName =
        part.kind === "execute"
          ? `Ran ${cmd ?? formatToolDisplayName(part.title, part.kind)}`
          : formatToolDisplayName(part.title, part.kind);
      return (
        <Tool key={partKey} data-status={part.status} data-testid="chat-tool" defaultOpen={false}>
          <ToolHeader
            compact
            expandable={hasBody}
            glyph={glyph}
            hideStatusBadge
            state={state}
            title={displayName}
            toolName={part.kind ?? "tool"}
            trailing={part.kind === "execute" ? <CommandStatusBadge status={part.status} /> : null}
            type="dynamic-tool"
          />
          <span className="sr-only" data-testid="chat-tool-status">
            {toolStatusLabel(part.status)}
          </span>
          {hasBody && (
            <ToolContent>
              {cmd != null && (
                <div className="overflow-hidden rounded-md border bg-card">
                  <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
                    <span>Shell</span>
                    <CommandStatusBadge status={part.status} testId="command-status-badge-expanded" />
                  </div>
                  <div className="px-3 py-2 font-mono text-xs">
                    <div className="text-foreground">
                      <span className="mr-2 text-muted-foreground">$</span>
                      {cmd}
                    </div>
                  </div>
                </div>
              )}
              {cmd == null && part.rawInput != null && <ToolInput input={part.rawInput} />}
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
    case "file_edit": {
      const fileName = part.path.split("/").pop() ?? part.path;
      const stats = (
        <span className="shrink-0 font-mono text-xs tabular-nums" data-testid="edit-stats">
          <span className="text-status-success">+{part.additions}</span>{" "}
          <span className="text-destructive">-{part.deletions}</span>
        </span>
      );
      const editGlyph = toolGlyph("edit", "completed");
      // Title click jumps to the full Diff tab; chevron toggles the inline new-text preview.
      const titleButton = (
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid="chat-file-chip"
          type="button"
          onClick={() => handlers?.onOpenFile?.(part.path)}
        >
          {editGlyph}
          <span className="truncate text-xs">
            Edited <span className="font-mono">{fileName}</span>
          </span>
        </button>
      );
      if (!part.diff) {
        return (
          <div
            key={partKey}
            className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-card/50"
            data-testid="chat-tool"
          >
            {titleButton}
            {stats}
          </div>
        );
      }
      return (
        <Tool key={partKey} data-testid="chat-tool" defaultOpen={false}>
          <div className="flex w-full items-center gap-2 px-2 py-1.5">
            {titleButton}
            {stats}
            <CollapsibleTrigger className="shrink-0" data-testid="edit-expand">
              <ChevronDownIcon className="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
          </div>
          <ToolContent>
            <CodeBlock code={part.diff} language="diff" />
          </ToolContent>
        </Tool>
      );
    }
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
    case "subagent": {
      const verdictChip = part.verdict ? (
        <Badge
          className={cn("h-5 px-1.5 text-[10px] capitalize", SUBAGENT_VERDICT_CLASS[part.verdict])}
          data-testid="subagent-verdict"
          variant="outline"
        >
          {part.verdict}
        </Badge>
      ) : null;
      const running = part.status === "running";
      return (
        <Tool key={partKey} data-testid="chat-subagent" defaultOpen={running}>
          <ToolHeader
            compact
            glyph={toolGlyph("execute", running ? "running" : "completed")}
            hideStatusBadge
            state={mapToolState(running ? "running" : "completed")}
            title={part.name}
            toolName="subagent"
            trailing={
              part.status === "failed" ? (
                <Badge className="h-5 px-1.5 text-[10px] text-destructive" variant="outline">
                  Failed
                </Badge>
              ) : (
                verdictChip
              )
            }
            type="dynamic-tool"
          />
          <ToolContent>
            {groupToolParts(part.parts).map((item) =>
              item.kind === "tool-group"
                ? renderToolGroup({ parts: item.parts, handlers, groupKey: `${partKey}-${item.key}` })
                : renderChatPart({
                    part: item.part,
                    handlers,
                    isStreaming: running && item.part.type === "text",
                    partKey: `${partKey}-${item.key}`,
                  }),
            )}
          </ToolContent>
        </Tool>
      );
    }
    default:
      return null;
  }
}

function renderToolGroup({
  parts,
  handlers,
  groupKey,
}: {
  parts: GroupToolPart[];
  handlers?: ChatPartHandlers;
  groupKey: string;
}) {
  const { title, count } = groupToolSummary(parts);
  const status = groupToolStatus(parts);
  const anySearch = parts.some((p) => p.kind === "search");
  const pill = (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
      {count}
    </span>
  );
  return (
    <Tool key={groupKey} data-testid="chat-tool-group" defaultOpen={false}>
      <ToolHeader
        compact
        glyph={groupGlyph(anySearch, status)}
        hideStatusBadge
        state={mapToolState(status)}
        title={title}
        toolName="tool-group"
        trailing={pill}
        type="dynamic-tool"
      />
      <ToolContent>
        <ul className="space-y-1.5">
          {parts.map((p, index) => {
            const verb = p.kind === "search" ? "Searched" : "Read";
            const target =
              p.locations[0]?.path ?? formatToolDisplayName(p.title, p.kind);
            const openable = p.locations[0]?.path;
            return (
              <li
                key={`${p.toolCallId}-${index}`}
                className="flex items-baseline gap-2 text-xs"
              >
                <span className="w-16 shrink-0 text-muted-foreground">{verb}</span>
                {openable ? (
                  <button
                    className={cn("truncate text-left font-mono text-foreground/70 hover:text-foreground")}
                    type="button"
                    onClick={() => handlers?.onOpenFile?.(openable)}
                  >
                    {target}
                  </button>
                ) : (
                  <span className="truncate font-mono text-foreground/70">{target}</span>
                )}
              </li>
            );
          })}
        </ul>
      </ToolContent>
    </Tool>
  );
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
        {groupToolParts(message.parts).map((item: RenderItem) =>
          item.kind === "tool-group"
            ? renderToolGroup({
                parts: item.parts,
                handlers,
                groupKey: `${message.id}-${item.key}`,
              })
            : renderChatPart({
                part: item.part,
                handlers,
                isStreaming: isStreaming && item.part.type === "text",
                partKey: `${message.id}-${item.key}`,
              }),
        )}
      </MessageContent>
    </Message>
  );
}
