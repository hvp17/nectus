import { type FormEvent, useEffect, useState } from "react";
import { Check, GitPullRequest, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "@/lib/utils";
import { AgentLogo } from "./AgentBrand";
import { PrReviewDetail } from "./PrReviewDetail";
import { PrReviewBadge } from "./PrReviewBadge";
import { resolveAgentProfileId } from "../lib/agentProfiles";
import type { AgentProfile, PrReview, PrReviewRun } from "../types";

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
const DEFAULT_ROUNDS = 3;

interface ReviewsPageProps {
  prReviews: PrReview[];
  selectedPrReview?: PrReview;
  selectedPrReviewId?: number;
  selectedPrReviewRuns: PrReviewRun[];
  /** Live stdout of the selected single review's reviewer, for the Terminal view. */
  liveReviewOutput?: string;
  agentProfiles: AgentProfile[];
  defaultReviewerProfileId?: number;
  creatingReview: boolean;
  onSelectReview: (reviewId: number) => void;
  onCreateReview: (prUrl: string, reviewerProfileIds: number[], rounds?: number) => void;
  onRerunReview: (reviewId: number) => void;
  onDeleteReview: (reviewId: number) => void;
  onPostReview: (reviewId: number) => Promise<unknown>;
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
  liveReviewOutput = "",
  agentProfiles,
  defaultReviewerProfileId,
  creatingReview,
  onSelectReview,
  onCreateReview,
  onRerunReview,
  onDeleteReview,
  onPostReview,
}: ReviewsPageProps) {
  const [prUrl, setPrUrl] = useState("");
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<number[]>(() => {
    const initial = resolveAgentProfileId(agentProfiles, defaultReviewerProfileId);
    return initial !== undefined ? [initial] : [];
  });
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const availableReviewerIds = new Set(agentProfiles.map((profile) => profile.id));
  const fallbackReviewerId = resolveAgentProfileId(agentProfiles, defaultReviewerProfileId);
  const activeReviewerIds = selectedReviewerIds.filter((id) => availableReviewerIds.has(id));

  // The lazy initializer captures `[]` when profiles haven't loaded at mount;
  // seed the default once it becomes available, but only while the selection is
  // still empty so a user pick is never clobbered.
  useEffect(() => {
    if (fallbackReviewerId === undefined) return;
    setSelectedReviewerIds((current) => (current.length === 0 ? [fallbackReviewerId] : current));
  }, [fallbackReviewerId]);

  // Two or more reviewers turns the review into a multi-model consensus run.
  const consensus = activeReviewerIds.length >= 2;
  // The reviewers a submit will use: the explicitly-selected ones, else the
  // resolved default as a single reviewer, else none.
  const reviewers =
    activeReviewerIds.length > 0
      ? activeReviewerIds
      : fallbackReviewerId !== undefined
        ? [fallbackReviewerId]
        : [];
  const hasReviewer = reviewers.length > 0;

  const toggleReviewer = (id: number) => {
    setSelectedReviewerIds((current) => {
      if (!current.includes(id)) return [...current, id];
      if (current.length === 1) return current; // keep at least one reviewer
      return current.filter((value) => value !== id);
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = prUrl.trim();
    if (!trimmed || creatingReview || reviewers.length === 0) return;
    onCreateReview(trimmed, reviewers, consensus ? rounds : undefined);
    setPrUrl("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-[22px]">
      <div>
        <h1 className="m-0 text-[23px] font-semibold tracking-[-0.01em]">
          PR Reviews
          {consensus && (
            <span className="text-[13px] font-semibold tracking-normal text-muted-foreground">
              {" · Consensus"}
            </span>
          )}
        </h1>
        <p className="mt-[3px] mb-0 text-[13px] text-muted-foreground">
          Paste a GitHub pull request link to review it against a known project. Pick two or more
          reviewers to run a multi-model consensus.
        </p>
      </div>

      <form
        className="flex flex-none flex-col gap-2.5 rounded-lg bg-card px-4 py-[15px] shadow-xs ring-1 ring-border"
        onSubmit={submit}
        aria-label="Start a PR review"
      >
        <div className="flex items-center gap-2.5">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://github.com/owner/repo/pull/123"
            aria-label="Pull request URL"
            className="flex-1 font-mono"
            value={prUrl}
            onChange={(event) => setPrUrl(event.target.value)}
          />
          <Button
            type="submit"
            disabled={creatingReview || !prUrl.trim() || !hasReviewer}
            aria-label="Review pull request"
          >
            {creatingReview ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <GitPullRequest data-icon="inline-start" />
            )}
            {creatingReview ? "Starting…" : consensus ? "Review with consensus" : "Review PR"}
          </Button>
        </div>
        {agentProfiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Reviewers
            </span>
            {agentProfiles.map((profile) => {
              const on = selectedReviewerIds.includes(profile.id);
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={cn(
                    "inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-md border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground transition-colors",
                    "data-[on=true]:border-primary data-[on=true]:bg-primary/12 data-[on=true]:text-primary",
                  )}
                  data-on={on}
                  aria-pressed={on}
                  onClick={() => toggleReviewer(profile.id)}
                >
                  <Check className={cn("size-[13px]", on ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  <AgentLogo agentKind={profile.agentKind} size="sm" />
                  {profile.name}
                </button>
              );
            })}
            {consensus && (
              <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
                Rounds
                <Input
                  type="number"
                  min={MIN_ROUNDS}
                  max={MAX_ROUNDS}
                  aria-label="Consensus rounds"
                  className="w-14 text-center"
                  value={rounds}
                  onChange={(event) =>
                    setRounds(Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Number(event.target.value) || MIN_ROUNDS)))
                  }
                />
              </label>
            )}
          </div>
        )}
      </form>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-4">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-[2px]" aria-label="PR review list">
          {prReviews.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3.5 text-xs text-muted-foreground">
              No reviews yet. Paste a pull request link above to start one.
            </p>
          ) : (
            groupReviews(prReviews).map((section) => (
              <section key={section.key} aria-label={section.label}>
                <h2 className="mb-2 mt-0 flex items-center gap-[7px] px-[2px] text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
                  {section.label}
                  <span className="font-mono font-semibold">{section.reviews.length}</span>
                </h2>
                {section.reviews.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">Nothing here yet.</p>
                ) : (
                  section.reviews.map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      className={cn(
                        "mb-2 flex w-full cursor-pointer flex-col gap-1.5 rounded-lg bg-card px-3 py-[11px] text-left ring-1 ring-border transition-shadow",
                        "not-data-[active=true]:hover:ring-primary/40",
                        "data-[active=true]:bg-primary/6 data-[active=true]:ring-[1.5px] data-[active=true]:ring-primary",
                      )}
                      data-active={review.id === selectedPrReviewId}
                      aria-pressed={review.id === selectedPrReviewId}
                      onClick={() => onSelectReview(review.id)}
                    >
                      <div className="flex items-center gap-2">
                        <PrReviewBadge review={review} />
                        {review.mode === "consensus" && (
                          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-muted-foreground">
                            {review.reviewers.length}-model
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[11.5px] font-bold text-muted-foreground">
                          #{review.prNumber}
                        </span>
                      </div>
                      <div className="w-full truncate text-[13px] font-semibold leading-[1.3]">
                        {review.prTitle ?? review.prUrl}
                      </div>
                      <div className="w-full truncate text-[11px] text-muted-foreground">
                        {review.repoName}
                        {review.prAuthor ? ` · ${review.prAuthor}` : ""}
                      </div>
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
            liveReviewOutput={liveReviewOutput}
            agentProfiles={agentProfiles}
            onRerun={onRerunReview}
            onDelete={onDeleteReview}
            onPost={onPostReview}
          />
        ) : (
          <section
            className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-card shadow-xs ring-1 ring-border"
            aria-label="PR review"
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 p-[30px] text-center text-muted-foreground">
              <GitPullRequest size={22} aria-hidden="true" />
              <strong className="text-sm font-semibold text-foreground">No review selected</strong>
              <span>Select a review from the list to see its feedback.</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
