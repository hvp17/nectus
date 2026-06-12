import { AlertTriangle, CheckCircle2, GitPullRequest, MessageSquareReply } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { openExternal } from "../../lib/openExternal";
import { formatAttentionReason, type TaskAttention } from "../../sessionAttention";

/// The attention banner shown beneath the live terminal when a session finishes
/// or needs input. Reply focuses the live terminal so the user can answer inline.
export function ActionBar({
  attention,
  agentName,
  detail,
  detailTitle,
  prUrl,
  canCreatePullRequest,
  onCreatePullRequest,
}: {
  attention: TaskAttention;
  agentName?: string | null;
  detail?: string | null;
  detailTitle?: string;
  prUrl?: string | null;
  canCreatePullRequest: boolean;
  onCreatePullRequest: () => void;
}) {
  const needsInput = attention.kind === "needs_input";
  // Reply focuses the live terminal so the user can type their answer inline.
  const focusTerminal = () => {
    if (typeof document === "undefined") return;
    document.querySelector<HTMLTextAreaElement>("[data-task-workspace] .xterm-helper-textarea")?.focus();
  };
  const showOpenPr = Boolean(prUrl || canCreatePullRequest);
  const openPr = () => {
    if (prUrl) openExternal(prUrl);
    else if (canCreatePullRequest) onCreatePullRequest();
  };
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 border-t px-3.5 py-3",
        needsInput ? "border-status-warning/30 bg-status-warning/10" : "border-primary/25 bg-primary/5",
      )}
    >
      <span
        className={cn(
          "grid size-[30px] shrink-0 place-items-center rounded-md",
          needsInput ? "bg-status-warning/15 text-status-warning" : "bg-primary/15 text-primary",
        )}
        aria-hidden="true"
      >
        {needsInput ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold">{needsInput ? `${agentName ?? "Agent"} needs your decision` : "Agent finished"}</div>
        {detail && (
          <div className="truncate text-xs text-muted-foreground" title={detailTitle}>
            {needsInput ? detail ?? formatAttentionReason(attention.reason) : detail}
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {needsInput && (
          <Button type="button" variant="outline" size="sm" onClick={focusTerminal}>
            <MessageSquareReply data-icon="inline-start" />
            Reply
          </Button>
        )}
        {showOpenPr && (
          <Button type="button" size="sm" onClick={openPr}>
            <GitPullRequest data-icon="inline-start" />
            {prUrl ? "Open PR" : "Create PR"}
          </Button>
        )}
      </div>
    </div>
  );
}
