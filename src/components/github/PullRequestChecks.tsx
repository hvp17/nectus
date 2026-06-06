import { useState } from "react";
import { CheckCircle2, ChevronRight, Clock, ExternalLink, XCircle } from "lucide-react";
import { openExternal } from "../../lib/openExternal";
import type { GithubCheckRun, GithubCheckRunState, GithubCheckSummary } from "../../types";

interface PullRequestChecksProps {
  checks: GithubCheckSummary;
  /** Per-check detail (GitHub Actions runs + commit statuses). */
  checkRuns: GithubCheckRun[];
}

function CheckStateIcon({ state }: { state: GithubCheckRunState }) {
  if (state === "pass") return <CheckCircle2 size={13} className="shrink-0 text-status-success" aria-hidden />;
  if (state === "fail") return <XCircle size={13} className="shrink-0 text-destructive" aria-hidden />;
  return <Clock size={13} className="shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * The PR's CI summary (passed/failed/pending counts) plus an expandable drill-down
 * listing each GitHub Actions run / commit status by `workflow / name`, with a link
 * to its run page. Counts always show; the list expands only when named checks
 * exist. Renders nothing when the PR has no checks at all.
 */
export function PullRequestChecks({ checks, checkRuns }: PullRequestChecksProps) {
  const [expanded, setExpanded] = useState(false);
  if (checks.total === 0) return null;
  const expandable = checkRuns.length > 0;

  const summary = (
    <div className="flex w-full items-center gap-3.5" aria-label="Pull request checks">
      <span data-check="passed" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-status-success">
        <CheckCircle2 size={13} />
        {checks.passed}
      </span>
      <span data-check="failed" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-destructive">
        <XCircle size={13} />
        {checks.failed}
      </span>
      <span data-check="pending" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-muted-foreground">
        <Clock size={13} />
        {checks.pending}
      </span>
      {expandable && (
        <ChevronRight
          size={13}
          className={`ml-auto text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        />
      )}
    </div>
  );

  return (
    <div className="px-3 pb-2.5">
      {expandable ? (
        <button
          type="button"
          className="flex w-full items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide check details" : "Show check details"}
          onClick={() => setExpanded((value) => !value)}
        >
          {summary}
        </button>
      ) : (
        summary
      )}

      {expanded && (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Checks">
          {checkRuns.map((check, index) => (
            <li key={`${check.workflow ?? ""}/${check.name}/${index}`} className="flex items-center gap-2 text-[11.5px]">
              <CheckStateIcon state={check.state} />
              <span className="min-w-0 flex-1 truncate" title={check.workflow ? `${check.workflow} / ${check.name}` : check.name}>
                {check.workflow && <span className="text-muted-foreground">{check.workflow} / </span>}
                <span className="font-medium">{check.name}</span>
              </span>
              {check.url && (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground"
                  aria-label={`Open ${check.name} check`}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternal(check.url!);
                  }}
                >
                  <ExternalLink size={11} />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
