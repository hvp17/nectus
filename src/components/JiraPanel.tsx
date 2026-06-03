import { ExternalLink, Unlink } from "lucide-react";
import { openExternal } from "../lib/openExternal";
import { jiraBrowseUrl } from "../lib/jira";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { TaskSummary } from "../types";

interface JiraPanelProps {
  task: TaskSummary;
  /** Connected JIRA site host, used to build the issue's browse URL. */
  site?: string | null;
  onSetJiraLink: (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) => void;
}

/**
 * Compact task-inspector panel for the linked JIRA story. Display + detach only;
 * attaching happens from the JIRA board's create-from-story flow. Renders nothing
 * when the task has no link.
 */
export function JiraPanel({ task, site, onSetJiraLink }: JiraPanelProps) {
  if (!task.jiraIssueKey) return null;

  // Prefer the canonical browse URL built from the connected site, so links
  // attached before this fix (which stored the REST self-link) still open the
  // right page. Fall back to the stored URL only when the site is unknown.
  const browseUrl = jiraBrowseUrl(site, task.jiraIssueKey) ?? task.jiraIssueUrl;

  return (
    <section className="task-jira-panel mt-4 rounded-lg border p-3" aria-label="JIRA story">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">JIRA Story</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onSetJiraLink(task.id, null)}
        >
          <Unlink className="size-3.5" />
          Detach
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {task.jiraIssueKey}
        </Badge>
        {browseUrl && (
          <a
            className="task-meta-link"
            href={browseUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternal(browseUrl);
            }}
          >
            Open <ExternalLink size={12} />
          </a>
        )}
      </div>
      {task.jiraIssueSummary && (
        <p className="mt-1 text-sm text-muted-foreground">{task.jiraIssueSummary}</p>
      )}
    </section>
  );
}
