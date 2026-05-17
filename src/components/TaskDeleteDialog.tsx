import { useState, type ComponentProps } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { TaskSummary } from "../types";

interface TaskDeleteDialogProps {
  task: TaskSummary;
  busy?: boolean;
  isDeleting?: boolean;
  onDelete: (task: TaskSummary) => void;
  buttonClassName?: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  buttonSize?: ComponentProps<typeof Button>["size"];
  showButtonText?: boolean;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
}

export function TaskDeleteDialog({
  task,
  busy = false,
  isDeleting = false,
  onDelete,
  buttonClassName,
  buttonVariant = "ghost",
  buttonSize = "icon",
  showButtonText = false,
  tooltipSide = "top",
}: TaskDeleteDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteDisabled = busy || isDeleting || Boolean(task.activeSessionId);
  const deleteLabel = task.activeSessionId ? "Stop session first" : isDeleting ? "Deleting task" : "Delete task";
  const deleteDescription = task.hasWorktree
    ? `This removes "${task.title}" and its worktree from Nectus and disk.`
    : `This removes "${task.title}" from Nectus. No files are deleted.`;

  return (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant={buttonVariant}
              size={buttonSize}
              className={buttonClassName}
              disabled={deleteDisabled}
              aria-label={deleteLabel}
              onClick={(event) => event.stopPropagation()}
            >
              <Trash2 data-icon={showButtonText ? "inline-start" : undefined} />
              {showButtonText && <span>{deleteLabel}</span>}
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} className="text-xs">
          {deleteLabel}
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent onClick={(event) => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete task?</AlertDialogTitle>
          <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setDeleteDialogOpen(false);
              onDelete(task);
            }}
          >
            Delete Task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
