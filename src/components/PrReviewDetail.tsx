import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { PrReviewBadge, PrReviewVerdictBadge } from "./PrReviewBadge";
import type { PrReview, PrReviewRun, PrReviewStatus } from "../types";

interface PrReviewDetailProps {
  review: PrReview;
  runs: PrReviewRun[];
  onRerun: (reviewId: number) => void;
  onDelete: (reviewId: number) => void;
}

const inFlight = (status: PrReviewStatus) => status === "queued" || status === "reviewing";

interface RoundGroup {
  round: number;
  runs: PrReviewRun[];
}

/// Bucket a consensus review's flat run list into ascending rounds for display.
function groupRunsByRound(runs: PrReviewRun[]): RoundGroup[] {
  const byRound = new Map<number, PrReviewRun[]>();
  for (const run of runs) {
    const list = byRound.get(run.round) ?? [];
    list.push(run);
    byRound.set(run.round, list);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, roundRuns]) => ({ round, runs: roundRuns }));
}

function consensusSummary(review: PrReview): string {
  const count = review.reviewers.length;
  if (review.status === "ready") {
    return review.converged
      ? `Converged in ${review.roundsCompleted} round${review.roundsCompleted === 1 ? "" : "s"}`
      : `No consensus after ${review.roundsCompleted} round${review.roundsCompleted === 1 ? "" : "s"}`;
  }
  const cap = review.maxRounds ?? "?";
  return `${count} reviewers · round ${review.roundsCompleted}/${cap}`;
}

export function PrReviewDetail({ review, runs, onRerun, onDelete }: PrReviewDetailProps) {
  const [copied, setCopied] = useState(false);
  const isConsensus = review.mode === "consensus";

  // Reset the copied affordance when switching reviews or after a re-run.
  useEffect(() => {
    setCopied(false);
  }, [review.id, review.reviewOutput]);

  const copyReview = async () => {
    if (!review.reviewOutput) return;
    try {
      await navigator.clipboard.writeText(review.reviewOutput);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card" aria-label="PR review">
      <header className="flex flex-col gap-2 border-b p-4">
        <div className="flex items-center gap-2">
          <PrReviewBadge review={review} />
          {isConsensus && (
            <span className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
              {review.reviewers.length}-model consensus
            </span>
          )}
          <span className="text-sm font-semibold text-muted-foreground">#{review.prNumber}</span>
          <span className="truncate text-sm font-semibold">{review.prTitle ?? review.prUrl}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{review.repoName}</span>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.baseBranch && <span>base {review.baseBranch}</span>}
          {isConsensus && <span>{consensusSummary(review)}</span>}
          <a
            className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open PR <ExternalLink size={11} />
          </a>
        </div>
        {isConsensus && review.reviewers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Reviewers:</span>
            {review.reviewers.map((reviewer) => (
              <span key={reviewer.reviewerProfileId} className="rounded bg-muted px-1.5 py-0.5">
                {reviewer.reviewerName ?? `#${reviewer.reviewerProfileId}`}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={inFlight(review.status)}
            onClick={() => onRerun(review.id)}
            aria-label="Re-run review"
          >
            <RefreshCw data-icon="inline-start" className={inFlight(review.status) ? "animate-spin" : undefined} />
            Re-run
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={review.status !== "ready" || !review.reviewOutput}
            onClick={copyReview}
            aria-label={isConsensus ? "Copy consensus review" : "Copy review"}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : isConsensus ? "Copy consensus" : "Copy review"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => onDelete(review.id)}
            aria-label="Delete review"
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-4">{isConsensus ? renderConsensusBody() : renderSingleBody()}</div>
    </section>
  );

  function renderSingleBody() {
    if (review.status === "error") {
      return (
        <Alert variant="destructive">
          <AlertTitle>Review failed</AlertTitle>
          <AlertDescription>{review.lastError ?? "Unknown error"}</AlertDescription>
        </Alert>
      );
    }

    if (inFlight(review.status)) {
      return (
        <div className="flex flex-col gap-3" aria-label="Review in progress">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle size={14} className="animate-spin" />
            {review.status === "queued" ? "Queued — preparing worktree…" : "Reviewing the pull request…"}
          </p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      );
    }

    return (
      <ScrollArea className="h-full">
        <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
          {review.reviewOutput ?? "The reviewer returned no output."}
        </pre>
      </ScrollArea>
    );
  }

  function renderConsensusBody() {
    const rounds = groupRunsByRound(runs);
    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4" aria-label="Consensus review">
          {review.status === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Review failed</AlertTitle>
              <AlertDescription>{review.lastError ?? "Unknown error"}</AlertDescription>
            </Alert>
          )}

          {review.status === "ready" ? (
            <section aria-label="Consensus review output" className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Consensus review
              </h3>
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono text-sm leading-relaxed text-foreground">
                {review.reviewOutput ?? "The reviewers returned no consensus output."}
              </pre>
            </section>
          ) : (
            inFlight(review.status) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle size={14} className="animate-spin" />
                {review.status === "queued"
                  ? "Queued — preparing worktree…"
                  : "Reviewers are reviewing and comparing notes…"}
              </p>
            )
          )}

          {rounds.length > 0 && (
            <section aria-label="Review rounds" className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Rounds
              </h3>
              {rounds.map((group) => (
                <div
                  key={group.round}
                  role="group"
                  className="flex flex-col gap-2"
                  aria-label={`Round ${group.round}`}
                >
                  <span className="text-xs font-semibold text-muted-foreground">Round {group.round}</span>
                  {group.runs.map((run) => (
                    <details key={run.id} className="rounded-md border bg-background">
                      <summary className="flex cursor-pointer items-center gap-2 p-2 text-sm">
                        <span className="font-medium">{run.reviewerName ?? `#${run.reviewerProfileId}`}</span>
                        {run.error ? (
                          <span className="text-xs text-destructive">failed</span>
                        ) : (
                          <PrReviewVerdictBadge verdict={run.verdict} />
                        )}
                      </summary>
                      <pre className="whitespace-pre-wrap break-words border-t p-3 font-mono text-xs leading-relaxed text-foreground">
                        {run.error ?? run.output ?? "No output."}
                      </pre>
                    </details>
                  ))}
                </div>
              ))}
            </section>
          )}
        </div>
      </ScrollArea>
    );
  }
}
