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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
    <section className="github-panel" aria-label="GitHub">
      <div className="github-panel-header">
        <div className="github-panel-title">
          <Github size={14} />
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">GitHub</p>
        </div>
        {githubStatus?.authenticated && (
          <Badge variant="outline" className="rounded-md font-normal">
            {githubStatus.account ?? "Connected"}
          </Badge>
        )}
      </div>

      {renderBody()}
    </section>
  );

  function renderBody() {
    if (!githubStatus) {
      return <p className="github-panel-hint">Checking GitHub CLI…</p>;
    }
    if (!githubStatus.installed) {
      return (
        <p className="github-panel-hint">
          GitHub CLI not found. Install <code>gh</code> to open pull requests from Nectus.
        </p>
      );
    }
    if (!githubStatus.authenticated) {
      return (
        <p className="github-panel-hint">
          Not signed in. Run <code>gh auth login</code> in your terminal to connect.
        </p>
      );
    }

    if (task.prUrl) {
      return renderPullRequest(task.prUrl);
    }

    if (!task.hasWorktree) {
      return (
        <p className="github-panel-hint">Add a worktree branch to open a pull request from Nectus.</p>
      );
    }

    return (
      <div className="github-panel-create">
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
      <div className="github-pr-card">
        <div className="github-pr-row">
          <span className="github-pr-number">
            {pullRequest ? `#${pullRequest.number}` : "Pull request"}
          </span>
          {pullRequest && (
            <Badge variant="outline" className="rounded-md" data-pr-state={pullRequest.state}>
              {prStateLabel(pullRequest)}
            </Badge>
          )}
          {pullRequest?.reviewDecision && (
            <Badge variant="outline" className="rounded-md font-normal">
              {reviewDecisionLabels[pullRequest.reviewDecision]}
            </Badge>
          )}
        </div>

        {pullRequest && pullRequest.checks.total > 0 && (
          <div className="github-checks" aria-label="Pull request checks">
            {pullRequest.checks.passed > 0 && (
              <span className="github-check github-check-passed">
                <CheckCircle2 size={13} />
                {pullRequest.checks.passed}
              </span>
            )}
            {pullRequest.checks.failed > 0 && (
              <span className="github-check github-check-failed">
                <XCircle size={13} />
                {pullRequest.checks.failed}
              </span>
            )}
            {pullRequest.checks.pending > 0 && (
              <span className="github-check github-check-pending">
                <Clock size={13} />
                {pullRequest.checks.pending}
              </span>
            )}
          </div>
        )}

        {pullRequestLoading && !pullRequest && (
          <p className="github-panel-hint">
            <LoaderCircle size={13} className="mr-1 inline animate-spin" />
            Loading status…
          </p>
        )}

        <div className="github-pr-actions">
          <a
            className="github-pr-link"
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open pull request"
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
