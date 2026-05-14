import { GitBranch, Bot, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TaskSummary } from "../types";

interface TaskCardProps {
  task: TaskSummary;
  isSelected: boolean;
  busy: boolean;
  confirmingDelete: boolean;
  onSelect: (id: number) => void;
  onDelete: (task: TaskSummary) => void;
}

export function TaskCard({ task, isSelected, busy, confirmingDelete, onSelect, onDelete }: TaskCardProps) {
  const deleteDisabled = busy || Boolean(task.activeSessionId);
  const deleteLabel = task.activeSessionId ? "Stop session first" : confirmingDelete ? "Confirm delete" : "Delete task";

  return (
    <Card
      className={`group relative flex flex-col gap-3 p-4 text-left cursor-pointer transition-all hover:border-primary/50 ${
        isSelected ? "border-primary ring-1 ring-primary/20 shadow-md bg-accent/5" : "hover:bg-accent/5"
      }`}
      onClick={() => onSelect(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <strong className="text-sm font-semibold leading-tight line-clamp-2">{task.title}</strong>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.activeSessionId && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px] animate-pulse">
              LIVE
            </Badge>
          )}
          
          <div className={`transition-opacity ${confirmingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <Tooltip open={confirmingDelete || undefined}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 text-destructive hover:bg-destructive/10 ${confirmingDelete ? "bg-destructive/10" : ""}`}
                  disabled={deleteDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task);
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {deleteLabel}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground font-mono">
          {task.hasWorktree ? <GitBranch size={12} className="opacity-70" /> : <Bot size={12} className="opacity-70" />}
          <span className="truncate">{task.hasWorktree ? task.branchName : "No worktree"}</span>
        </div>
        
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
          <span>{task.agentName ?? "No agent"}</span>
          <span>{task.hasWorktree ? (task.isDirty ? "dirty" : "clean") : "task"}</span>
        </div>
      </div>
    </Card>
  );
}
