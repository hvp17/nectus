import {
  FileText,
  Loader2,
  Pencil,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChatToolStatus } from "@/types";

/** Tint a glyph/badge by tool status, matching the mockup's resting/active states. */
function statusTint(status: ChatToolStatus): string {
  switch (status) {
    case "completed":
      return "text-status-success";
    case "failed":
      return "text-destructive";
    case "running":
    case "pending":
      return "text-status-info";
    default:
      return "text-muted-foreground";
  }
}

/** The lucide glyph for a tool kind, tinted by status (spinning while running). */
export function toolGlyph(kind: string | null | undefined, status: ChatToolStatus): ReactNode {
  const running = status === "running" || status === "pending";
  const tint = cn("size-3.5 shrink-0", running ? "text-status-info" : statusTint(status));
  if (running) return <Loader2 className={cn(tint, "animate-spin")} />;
  switch (kind) {
    case "execute":
      return <TerminalSquare className={tint} />;
    case "search":
      return <Search className={tint} />;
    // `fetch` is bucketed with reads in the group summary/verb, so keep its glyph
    // consistent with that ("Read"), not the search icon.
    case "read":
    case "fetch":
      return <FileText className={tint} />;
    case "edit":
      return <Pencil className={tint} />;
    default:
      return <Wrench className={tint} />;
  }
}

/** The glyph for a grouped read/search row (Search if the run searched, else FileText). */
export function groupGlyph(anySearch: boolean, status: ChatToolStatus): ReactNode {
  const running = status === "running" || status === "pending";
  const tint = cn("size-3.5 shrink-0", running ? "text-status-info" : statusTint(status));
  if (running) return <Loader2 className={cn(tint, "animate-spin")} />;
  return anySearch ? <Search className={tint} /> : <FileText className={tint} />;
}

/** Best-effort command string from a tool's rawInput (string | {command}). */
export function commandText(rawInput: unknown): string | null {
  if (typeof rawInput === "string") return rawInput;
  if (rawInput && typeof rawInput === "object" && "command" in rawInput) {
    const cmd = (rawInput as { command: unknown }).command;
    if (typeof cmd === "string") return cmd;
    if (Array.isArray(cmd) && cmd.every((c) => typeof c === "string")) return cmd.join(" ");
  }
  return null;
}

const BADGE_LABEL: Record<ChatToolStatus, string> = {
  completed: "Success",
  failed: "Failed",
  running: "Running",
  pending: "Running",
};

/** A labelled status badge with a coloured dot, for command rows. */
export function CommandStatusBadge({
  status,
  testId = "command-status-badge",
}: {
  status: ChatToolStatus;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        statusTint(status),
      )}
      data-testid={testId}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {BADGE_LABEL[status]}
    </span>
  );
}
