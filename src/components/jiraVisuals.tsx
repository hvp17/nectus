import { Bookmark, Bug, Layers, ListTree, SquareCheck, Zap, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface TypeStyle {
  icon: LucideIcon;
  bg: string;
  label: string;
}

// JIRA-style work-item type glyphs: a small rounded square in the type's colour
// with a white icon, matching the iconography people recognise from JIRA.
const TYPE_STYLES: Record<string, TypeStyle> = {
  story: { icon: Bookmark, bg: "#22A06B", label: "Story" },
  task: { icon: SquareCheck, bg: "#4688EC", label: "Task" },
  bug: { icon: Bug, bg: "#E2483D", label: "Bug" },
  epic: { icon: Zap, bg: "#6E5DC6", label: "Epic" },
  subtask: { icon: ListTree, bg: "#4688EC", label: "Sub-task" },
  "sub-task": { icon: ListTree, bg: "#4688EC", label: "Sub-task" },
};

const DEFAULT_STYLE: TypeStyle = { icon: Layers, bg: "#6B7785", label: "Work item" };

function typeStyle(type: string | null | undefined): TypeStyle {
  if (!type) return DEFAULT_STYLE;
  return TYPE_STYLES[type.toLowerCase().replace(/\s+/g, "")] ?? { ...DEFAULT_STYLE, label: type };
}

export function JiraIssueTypeIcon({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const style = typeStyle(type);
  const Icon = style.icon;
  return (
    <span
      className={cn("inline-grid size-4 shrink-0 place-items-center rounded-[5px]", className)}
      style={{ background: style.bg }}
      title={style.label}
      aria-label={style.label}
    >
      <Icon className="size-2.5 text-white" strokeWidth={2.5} absoluteStrokeWidth />
    </span>
  );
}

// Deterministic avatar palette so a given person keeps the same colour everywhere.
const AVATAR_COLORS = [
  "#206A83",
  "#5E4DB2",
  "#216E4E",
  "#A54800",
  "#943D73",
  "#0055CC",
  "#854C00",
  "#1F6E5B",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashIndex(value: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % length;
}

export function JiraAvatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) {
    return (
      <span
        className={cn(
          "inline-grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-muted-foreground/50 text-[9px] font-bold text-muted-foreground/70",
          className,
        )}
        title="Unassigned"
        aria-label="Unassigned"
      >
        –
      </span>
    );
  }
  const isYou = name.trim().toLowerCase() === "you";
  return (
    <span
      className={cn(
        "inline-grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white ring-1 ring-inset ring-white/15",
        className,
      )}
      style={{ background: isYou ? "var(--primary)" : AVATAR_COLORS[hashIndex(name, AVATAR_COLORS.length)] }}
      title={name}
      aria-label={name}
    >
      <span style={isYou ? { color: "var(--primary-foreground)" } : undefined}>{initials(name)}</span>
    </span>
  );
}
