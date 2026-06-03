import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, GitPullRequest, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { PrReviewDetail } from "./PrReviewDetail";
import { PrReviewBadge } from "./PrReviewBadge";
import type { AgentProfile, PrReview, PrReviewRun } from "../types";

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
const DEFAULT_ROUNDS = 3;

interface ReviewsPageProps {
  prReviews: PrReview[];
  selectedPrReview?: PrReview;
  selectedPrReviewId?: number;
  selectedPrReviewRuns: PrReviewRun[];
  agentProfiles: AgentProfile[];
  defaultReviewerProfileId?: number;
  creatingReview: boolean;
  onSelectReview: (reviewId: number) => void;
  onCreateReview: (prUrl: string, reviewerProfileIds: number[], maxRounds?: number) => void;
  onRerunReview: (reviewId: number) => void;
  onDeleteReview: (reviewId: number) => void;
  onBack: () => void;
}

interface ReviewSection {
  key: string;
  label: string;
  reviews: PrReview[];
}

/// Group reviews into the three lifecycle buckets. `done` collects both finished
/// reviews (whose verdict the badge surfaces) and reviews that errored out.
function groupReviews(reviews: PrReview[]): ReviewSection[] {
  return [
    { key: "to-review", label: "To review", reviews: reviews.filter((r) => r.status === "queued") },
    { key: "reviewing", label: "Reviewing", reviews: reviews.filter((r) => r.status === "reviewing") },
    {
      key: "done",
      label: "Done",
      reviews: reviews.filter((r) => r.status === "ready" || r.status === "error"),
    },
  ];
}

export function ReviewsPage({
  prReviews,
  selectedPrReview,
  selectedPrReviewId,
  selectedPrReviewRuns,
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
  const [reviewerProfileIds, setReviewerProfileIds] = useState<number[]>(
    defaultReviewerProfileId ? [defaultReviewerProfileId] : [],
  );
  const [maxRounds, setMaxRounds] = useState(DEFAULT_ROUNDS);
  // Seed the default reviewer once it is known (profiles load async). After the
  // user touches the selection we leave it alone.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && defaultReviewerProfileId !== undefined) {
      setReviewerProfileIds((current) => (current.length ? current : [defaultReviewerProfileId]));
      seeded.current = true;
    }
  }, [defaultReviewerProfileId]);

  const isConsensus = reviewerProfileIds.length >= 2;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = prUrl.trim();
    if (!trimmed || creatingReview || reviewerProfileIds.length === 0) return;
    onCreateReview(trimmed, reviewerProfileIds, isConsensus ? maxRounds : undefined);
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
            Paste a GitHub pull request link to review it. Pick two or more reviewers to run a
            multi-model consensus review.
          </p>
        </div>
      </header>

      <form className="flex flex-col gap-2" onSubmit={submit} aria-label="Start a PR review">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://github.com/owner/repo/pull/123"
            aria-label="Pull request URL"
            className="h-9 min-w-[260px] flex-1"
            value={prUrl}
            onChange={(event) => setPrUrl(event.target.value)}
          />
          <Button
            type="submit"
            disabled={creatingReview || !prUrl.trim() || reviewerProfileIds.length === 0}
            aria-label="Review pull request"
          >
            {creatingReview ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <GitPullRequest data-icon="inline-start" />
            )}
            {creatingReview ? "Starting…" : isConsensus ? "Review with consensus" : "Review PR"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            value={reviewerProfileIds.map(String)}
            onValueChange={(values) => setReviewerProfileIds(values.map(Number))}
            aria-label="Reviewers"
          >
            {agentProfiles.map((profile) => (
              <ToggleGroupItem key={profile.id} value={profile.id.toString()} aria-label={profile.name}>
                {profile.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {isConsensus && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Rounds
              <Input
                type="number"
                min={MIN_ROUNDS}
                max={MAX_ROUNDS}
                className="h-9 w-16"
                aria-label="Consensus rounds"
                value={maxRounds}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isNaN(next)) return;
                  setMaxRounds(Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, next)));
                }}
              />
            </label>
          )}
        </div>
      </form>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto" aria-label="PR review list">
          {prReviews.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>No reviews yet</EmptyTitle>
                <EmptyDescription>Paste a pull request link above to start one.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            groupReviews(prReviews).map((section) => (
              <section key={section.key} className="flex flex-col gap-2" aria-label={section.label}>
                <h2 className="flex items-center gap-1.5 px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                  <span className="text-muted-foreground/70">{section.reviews.length}</span>
                </h2>
                {section.reviews.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground/60">Nothing here yet.</p>
                ) : (
                  section.reviews.map((review) => (
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
                        <PrReviewBadge review={review} />
                        {review.mode === "consensus" && (
                          <span className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
                            {review.reviewers.length}-model
                          </span>
                        )}
                        <span className="ml-auto text-xs font-semibold text-muted-foreground">
                          #{review.prNumber}
                        </span>
                      </div>
                      <span className="truncate text-sm font-medium">{review.prTitle ?? review.prUrl}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {review.repoName}
                        {review.prAuthor ? ` · ${review.prAuthor}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </section>
            ))
          )}
        </div>

        {selectedPrReview ? (
          <PrReviewDetail
            review={selectedPrReview}
            runs={selectedPrReviewRuns}
            onRerun={onRerunReview}
            onDelete={onDeleteReview}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">Select a review to see its feedback.</p>
          </div>
        )}
      </div>
    </div>
  );
}
