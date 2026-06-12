import { Badge } from "../ui/badge";
import { TASK_STATUS_LABELS } from "../../statusLabels";
import type { TaskSummary } from "../../types";

export function TaskStatusBadges({ task }: { task: TaskSummary }) {
  return (
    <div className="mt-3 flex flex-none flex-wrap gap-1.5">
      <Badge variant="outline" data-status={task.status}>
        {TASK_STATUS_LABELS[task.status]}
      </Badge>
      {task.activeSessionId && (
        <Badge variant="outline" className="border-primary/40 text-primary">
          <span
            className="size-[7px] shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
            aria-hidden="true"
          />
          Running
        </Badge>
      )}
      {task.isDirty && (
        <Badge variant="outline" className="text-status-info">
          Dirty
        </Badge>
      )}
    </div>
  );
}
