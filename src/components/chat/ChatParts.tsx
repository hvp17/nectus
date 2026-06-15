import { memo, useState } from "react";
import { Streamdown } from "streamdown";
import { ChevronRight } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { ChatPart, ChatPlanStatus, ChatToolStatus } from "../../types";

/** Callbacks a transcript threads down to interactive parts. */
export interface ChatPartHandlers {
  /** Answer a permission request (requestId, chosen optionId). */
  onRespondPermission?: (requestId: string, optionId: string) => void;
  /** Open a touched file in the diff pane. */
  onOpenFile?: (path: string) => void;
}

const TOOL_STATUS_LABEL: Record<ChatToolStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const TOOL_STATUS_VARIANT: Record<ChatToolStatus, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
};

const PLAN_STATUS_LABEL: Record<ChatPlanStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Done",
};

type TextPart = Extract<ChatPart, { type: "text" }>;
type ReasoningPart = Extract<ChatPart, { type: "reasoning" }>;
type ToolPart = Extract<ChatPart, { type: "tool" }>;
type FileEditPart = Extract<ChatPart, { type: "file_edit" }>;
type PermissionPart = Extract<ChatPart, { type: "permission" }>;
type PlanPart = Extract<ChatPart, { type: "plan" }>;

/** Streaming-tolerant markdown (Streamdown handles half-open fences mid-stream). */
function TextPartView({ part }: { part: TextPart }) {
  return (
    <div className="nx-chat-text" data-testid="chat-text">
      <Streamdown>{part.text}</Streamdown>
    </div>
  );
}

/** Agent thinking — collapsed by default, expandable. */
function ReasoningBlock({ part }: { part: ReasoningPart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nx-chat-reasoning" data-testid="chat-reasoning" data-open={open}>
      <button
        type="button"
        className="nx-chat-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
        Reasoning
      </button>
      {open && (
        <div className="nx-chat-reasoning-body">
          <Streamdown>{part.text}</Streamdown>
        </div>
      )}
    </div>
  );
}

/** A tool call card: title + status pill, expandable to locations + output. */
function ToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const hasBody = part.locations.length > 0 || Boolean(part.output);
  return (
    <div className="nx-chat-tool" data-testid="chat-tool" data-status={part.status}>
      <button
        type="button"
        className="nx-chat-tool-header"
        aria-expanded={open}
        disabled={!hasBody}
        onClick={() => hasBody && setOpen((value) => !value)}
      >
        {hasBody && (
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
        )}
        {part.kind && (
          <Badge variant="outline" className="nx-chat-tool-kind">
            {part.kind}
          </Badge>
        )}
        <span className="nx-chat-tool-title">{part.title}</span>
        <Badge variant={TOOL_STATUS_VARIANT[part.status]} data-testid="chat-tool-status">
          {TOOL_STATUS_LABEL[part.status]}
        </Badge>
      </button>
      {open && hasBody && (
        <div className="nx-chat-tool-body">
          {part.locations.length > 0 && (
            <ul className="nx-chat-tool-locations">
              {part.locations.map((location, index) => (
                <li key={`${location.path}-${index}`} className="font-mono text-xs">
                  {location.path}
                  {location.line != null ? `:${location.line}` : ""}
                </li>
              ))}
            </ul>
          )}
          {part.output && <pre className="nx-chat-tool-output">{part.output}</pre>}
        </div>
      )}
    </div>
  );
}

/** A file the agent edited — click to open the diff pane. */
function FileChip({ part, onOpenFile }: { part: FileEditPart; onOpenFile?: ChatPartHandlers["onOpenFile"] }) {
  return (
    <button
      type="button"
      className="nx-chat-file-chip"
      data-testid="chat-file-chip"
      onClick={() => onOpenFile?.(part.path)}
    >
      <span className="font-mono text-xs">{part.path}</span>
      <span className="font-mono text-xs tabular-nums">
        <span className="text-status-success">+{part.additions}</span>{" "}
        <span className="text-destructive">-{part.deletions}</span>
      </span>
    </button>
  );
}

/** A pending permission request rendered as a native approve/deny card. */
function PermissionCard({
  part,
  onRespondPermission,
}: {
  part: PermissionPart;
  onRespondPermission?: ChatPartHandlers["onRespondPermission"];
}) {
  return (
    <div className="nx-chat-permission" data-testid="chat-permission">
      <p className="nx-chat-permission-title">{part.title}</p>
      <div className="nx-chat-permission-actions">
        {part.options.map((option) => (
          <Button
            key={option.optionId}
            type="button"
            size="sm"
            variant={option.kind.startsWith("allow") ? "default" : "outline"}
            onClick={() => onRespondPermission?.(part.requestId, option.optionId)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The agent's plan / todo list. */
function PlanList({ part }: { part: PlanPart }) {
  return (
    <ul className="nx-chat-plan" data-testid="chat-plan">
      {part.entries.map((entry, index) => (
        <li key={`${index}-${entry.content}`} className="nx-chat-plan-entry" data-status={entry.status}>
          <Badge variant="outline" className="nx-chat-plan-status">
            {PLAN_STATUS_LABEL[entry.status]}
          </Badge>
          <span>{entry.content}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Render one normalized chat part. Memoized + keyed by the caller so a streaming
 * text part re-renders without disturbing settled parts above it.
 */
export const ChatPartView = memo(function ChatPartView({
  part,
  handlers,
}: {
  part: ChatPart;
  handlers?: ChatPartHandlers;
}) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} />;
    case "reasoning":
      return <ReasoningBlock part={part} />;
    case "tool":
      return <ToolCard part={part} />;
    case "file_edit":
      return <FileChip part={part} onOpenFile={handlers?.onOpenFile} />;
    case "permission":
      return <PermissionCard part={part} onRespondPermission={handlers?.onRespondPermission} />;
    case "plan":
      return <PlanList part={part} />;
    default:
      return null;
  }
});
