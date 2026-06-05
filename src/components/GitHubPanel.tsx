import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Github,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { openExternal } from "../lib/openExternal";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Toggle } from "./ui/toggle";
import type {
  GithubStatus,
  PullRequestInfo,
  PullRequestReviewDecision,
  PullRequestState,
  TaskSummary,
} from "../types";

export interface GitHubPanelProps {
  task: TaskSummary;
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  pullRequestLoading?: boolean;
  creatingPullRequest?: boolean;
  onCreatePullRequest: (task: TaskSummary, options: { draft: boolean }) => void;
  onRefreshPullRequest: (task: TaskSummary) => void;
}

const reviewDecisionLabels: Record<PullRequestReviewDecision, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

function prStateLabel(pr: PullRequestInfo): string {
  if (pr.isDraft && pr.state === "open") return "Draft";
  const labels: Record<PullRequestState, string> = {
    open: "Open",
    merged: "Merged",
    closed: "Closed",
    unknown: "Unknown",
  };
  return labels[pr.state];
}

export function GitHubPanel({
  task,
  githubStatus,
  pullRequest,
  pullRequestLoading = false,
  creatingPullRequest = false,
  onCreatePullRequest,
  onRefreshPullRequest,
}: GitHubPanelProps) {
  const [draft, setDraft] = useState(false);

  return (
    <section aria-label="GitHub" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
          <GitPullRequest size={12} />
          Pull request
        </p>
        {githubStatus?.authenticated && (
          <Badge variant="outline" className="font-normal">
            {githubStatus.account ?? "Connected"}
          </Badge>
        )}
      </div>

      <div>{renderBody()}</div>
    </section>
  );

  function renderBody() {
    // A linked pull request is known from the task alone, so its card shows even
    // when the gh CLI is not connected (only the live checks need gh).
    if (task.prUrl) {
      return renderPullRequest(task.prUrl);
    }
    if (!githubStatus) {
      return <Skeleton className="h-9 w-full" />;
    }
    if (!githubStatus.installed) {
      return (
        <Alert>
          <Github size={16} />
          <AlertTitle>GitHub CLI not found</AlertTitle>
          <AlertDescription>
            Install <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">gh</code> to open pull
            requests from Nectus.
          </AlertDescription>
        </Alert>
      );
    }
    if (!githubStatus.authenticated) {
      return (
        <Alert>
          <XCircle size={16} />
          <AlertTitle>Not signed in</AlertTitle>
          <AlertDescription>
            Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">gh auth login</code> in your
            terminal to connect.
          </AlertDescription>
        </Alert>
      );
    }

    if (!task.hasWorktree) {
      return (
        <Alert>
          <GitPullRequest size={16} />
          <AlertDescription>Add a worktree branch to open a pull request from Nectus.</AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Toggle
          size="sm"
          variant="outline"
          pressed={draft}
          onPressedChange={setDraft}
          aria-label="Open as draft"
          className="h-8 px-3 text-xs"
        >
          Draft
        </Toggle>
        <Button
          type="button"
          aria-label="Create pull request"
          disabled={creatingPullRequest}
          onClick={() => onCreatePullRequest(task, { draft })}
        >
          {creatingPullRequest ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <GitPullRequest data-icon="inline-start" />
          )}
          {creatingPullRequest ? "Creating…" : "Create pull request"}
        </Button>
      </div>
    );
  }

  function renderPullRequest(prUrl: string) {
    return (
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
          <span className="font-mono text-xs font-bold">
            {pullRequest ? `#${pullRequest.number}` : "Pull request"}
          </span>
          {pullRequest && (
            <span
              data-pr-state={pullRequest.state}
              className={`inline-flex h-[19px] items-center gap-1 rounded-[5px] border px-1.5 text-[10.5px] font-bold ${prStateClassName(
                pullRequest,
              )}`}
            >
              {prStateLabel(pullRequest)}
            </span>
          )}
          {pullRequest?.reviewDecision && (
            <span className="inline-flex h-[19px] items-center rounded-[5px] border px-1.5 text-[10.5px] font-semibold text-muted-foreground">
              {reviewDecisionLabels[pullRequest.reviewDecision]}
            </span>
          )}
        </div>

        {pullRequest && pullRequest.checks.total > 0 && (
          <div className="flex items-center gap-3.5 px-3 pb-2.5" aria-label="Pull request checks">
            <span data-check="passed" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-status-success">
              <CheckCircle2 size={13} />
              {pullRequest.checks.passed}
            </span>
            <span data-check="failed" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-destructive">
              <XCircle size={13} />
              {pullRequest.checks.failed}
            </span>
            <span data-check="pending" className="inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums text-muted-foreground">
              <Clock size={13} />
              {pullRequest.checks.pending}
            </span>
          </div>
        )}

        {pullRequestLoading && !pullRequest && (
          <div className="flex flex-col gap-1.5 px-3 pb-2.5" aria-label="Loading pull request status">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
          <a
            className="inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open pull request"
            onClick={(event) => {
              event.preventDefault();
              openExternal(prUrl);
            }}
          >
            Open <ExternalLink size={12} />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Refresh pull request"
            disabled={pullRequestLoading}
            onClick={() => onRefreshPullRequest(task)}
          >
            <RefreshCw data-icon="inline-start" className={pullRequestLoading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>
    );
  }
}

// State pill colours: open → success-tinted, merged → chart-3, draft/closed → muted.
function prStateClassName(pr: PullRequestInfo): string {
  if (pr.isDraft && pr.state === "open") return "border-border text-muted-foreground";
  if (pr.state === "open") {
    return "border-status-success/40 bg-status-success/10 text-status-success";
  }
  if (pr.state === "merged") return "border-[var(--chart-3)]/40 text-[var(--chart-3)]";
  return "border-border text-muted-foreground";
}
