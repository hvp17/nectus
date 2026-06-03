import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { PrReviewBadge } from "./PrReviewBadge";
import type { PrReview, PrReviewStatus } from "../types";

interface PrReviewDetailProps {
  review: PrReview;
  onRerun: (reviewId: number) => void;
  onDelete: (reviewId: number) => void;
}

const inFlight = (status: PrReviewStatus) => status === "queued" || status === "reviewing";

export function PrReviewDetail({ review, onRerun, onDelete }: PrReviewDetailProps) {
  const [copied, setCopied] = useState(false);

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
          <span className="text-sm font-semibold text-muted-foreground">#{review.prNumber}</span>
          <span className="truncate text-sm font-semibold">{review.prTitle ?? review.prUrl}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{review.repoName}</span>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.baseBranch && <span>base {review.baseBranch}</span>}
          <a
            className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open PR <ExternalLink size={11} />
          </a>
        </div>
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
            aria-label="Copy review"
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy review"}
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

      <div className="min-h-0 flex-1 p-4">{renderBody()}</div>
    </section>
  );

  function renderBody() {
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
            {review.status === "queued" ? "Queued, preparing worktree…" : "Reviewing the pull request…"}
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
}
