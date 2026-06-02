import { type FormEvent, useState } from "react";
import { ArrowLeft, GitPullRequest, LoaderCircle } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { PrReviewDetail } from "./PrReviewDetail";
import type { AgentProfile, PrReview, PrReviewStatus } from "../types";

interface ReviewsPageProps {
  prReviews: PrReview[];
  selectedPrReview?: PrReview;
  selectedPrReviewId?: number;
  agentProfiles: AgentProfile[];
  defaultReviewerProfileId?: number;
  creatingReview: boolean;
  onSelectReview: (reviewId: number) => void;
  onCreateReview: (prUrl: string, reviewerProfileId?: number | null) => void;
  onRerunReview: (reviewId: number) => void;
  onDeleteReview: (reviewId: number) => void;
  onBack: () => void;
}

const statusLabels: Record<PrReviewStatus, string> = {
  queued: "Queued",
  reviewing: "Reviewing",
  ready: "Ready",
  error: "Error",
};

export function ReviewsPage({
  prReviews,
  selectedPrReview,
  selectedPrReviewId,
  agentProfiles,
  defaultReviewerProfileId,
  creatingReview,
  onSelectReview,
  onCreateReview,
  onRerunReview,
  onDeleteReview,
  onBack,
}: ReviewsPageProps) {
  const [prUrl, setPrUrl] = useState("");
  const [reviewerProfileId, setReviewerProfileId] = useState<number | undefined>(defaultReviewerProfileId);

  const reviewer = reviewerProfileId ?? defaultReviewerProfileId;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = prUrl.trim();
    if (!trimmed || creatingReview) return;
    onCreateReview(trimmed, reviewer ?? null);
    setPrUrl("");
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-lg font-bold tracking-tight">PR Reviews</h1>
          <p className="text-xs text-muted-foreground">
            Paste a GitHub pull request link to review it against a known project.
          </p>
        </div>
      </header>

      <form className="flex flex-wrap items-center gap-2" onSubmit={submit} aria-label="Start a PR review">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://github.com/owner/repo/pull/123"
          aria-label="Pull request URL"
          className="h-9 min-w-[260px] flex-1"
          value={prUrl}
          onChange={(event) => setPrUrl(event.target.value)}
        />
        <Select
          value={reviewer ? reviewer.toString() : undefined}
          onValueChange={(value) => setReviewerProfileId(Number(value))}
        >
          <SelectTrigger aria-label="Reviewer" className="h-9 w-[180px]">
            <SelectValue placeholder="Reviewer" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              {agentProfiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id.toString()} textValue={profile.name}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={creatingReview || !prUrl.trim()} aria-label="Review pull request">
          {creatingReview ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <GitPullRequest data-icon="inline-start" />
          )}
          {creatingReview ? "Starting…" : "Review PR"}
        </Button>
      </form>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto" aria-label="PR review list">
          {prReviews.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>No reviews yet</EmptyTitle>
                <EmptyDescription>Paste a pull request link above to start one.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            prReviews.map((review) => (
              <button
                key={review.id}
                type="button"
                aria-pressed={review.id === selectedPrReviewId}
                onClick={() => onSelectReview(review.id)}
                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                  review.id === selectedPrReviewId ? "border-primary bg-accent" : "bg-card"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-md font-normal"
                    data-pr-review-status={review.status}
                  >
                    {statusLabels[review.status]}
                  </Badge>
                  <span className="text-xs font-semibold text-muted-foreground">#{review.prNumber}</span>
                </div>
                <span className="truncate text-sm font-medium">{review.prTitle ?? review.prUrl}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {review.repoName}
                  {review.prAuthor ? ` · ${review.prAuthor}` : ""}
                </span>
              </button>
            ))
          )}
        </div>

        {selectedPrReview ? (
          <PrReviewDetail review={selectedPrReview} onRerun={onRerunReview} onDelete={onDeleteReview} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">Select a review to see its feedback.</p>
          </div>
        )}
      </div>
    </div>
  );
}
