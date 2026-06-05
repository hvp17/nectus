import { ExternalLink, Unlink } from "lucide-react";
import { openExternal } from "../lib/openExternal";
import { jiraBrowseUrl } from "../lib/jira";
import { Button } from "./ui/button";
import { JiraIssueTypeIcon } from "./jiraVisuals";
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

  // Compact "linked story" card: type glyph + KEY + summary + open affordance.
  // The issue type is not stored on the task link, so the glyph is the generic
  // work-item mark.
  const inner = (
    <>
      <JiraIssueTypeIcon type={null} className="size-4 rounded-[5px]" />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted-foreground">
          {task.jiraIssueKey}
        </span>
        {task.jiraIssueSummary && (
          <span className="block truncate text-xs text-foreground">{task.jiraIssueSummary}</span>
        )}
      </span>
      {browseUrl && <ExternalLink className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />}
    </>
  );

  return (
    <section className="flex flex-col gap-2.5" aria-label="JIRA story">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Linked story</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[11px] text-muted-foreground"
          onClick={() => onSetJiraLink(task.id, null)}
        >
          <Unlink className="size-3" />
          Detach
        </Button>
      </div>
      {browseUrl ? (
        <a
          href={browseUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            openExternal(browseUrl);
          }}
          className="flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-2 transition-colors hover:border-primary/50"
        >
          {inner}
        </a>
      ) : (
        <div className="flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-2">{inner}</div>
      )}
    </section>
  );
}
