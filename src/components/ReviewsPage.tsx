import { type FormEvent, useEffect, useState } from "react";
import { Check, GitPullRequest, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { AgentLogo } from "./AgentBrand";
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
  onCreateReview: (prUrl: string, reviewerProfileIds: number[], rounds?: number) => void;
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
}: ReviewsPageProps) {
  const [prUrl, setPrUrl] = useState("");
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<number[]>(() => {
    const initial = defaultReviewerProfileId ?? agentProfiles[0]?.id;
    return initial ? [initial] : [];
  });
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);

  // The lazy initializer captures `[]` when profiles haven't loaded at mount;
  // seed the default once it becomes available, but only while the selection is
  // still empty so a user pick is never clobbered.
  useEffect(() => {
    const initial = defaultReviewerProfileId ?? agentProfiles[0]?.id;
    if (initial === undefined) return;
    setSelectedReviewerIds((current) => (current.length === 0 ? [initial] : current));
  }, [defaultReviewerProfileId, agentProfiles]);

  // Two or more reviewers turns the review into a multi-model consensus run.
  const consensus = selectedReviewerIds.length >= 2;

  const toggleReviewer = (id: number) => {
    setSelectedReviewerIds((current) =>
      current.includes(id)
        ? current.length > 1
          ? current.filter((value) => value !== id)
          : current
        : [...current, id],
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = prUrl.trim();
    if (!trimmed || creatingReview) return;
    const reviewers = selectedReviewerIds.length
      ? selectedReviewerIds
      : defaultReviewerProfileId
        ? [defaultReviewerProfileId]
        : [];
    onCreateReview(trimmed, reviewers, consensus ? rounds : undefined);
    setPrUrl("");
  };

  return (
    <div className="nx-rev">
      <div>
        <h1 className="nx-h1" style={{ fontSize: 23 }}>
          PR Reviews
          {consensus && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)", letterSpacing: 0 }}>
              {" · Consensus"}
            </span>
          )}
        </h1>
        <p className="nx-sub">
          Paste a GitHub pull request link to review it against a known project. Pick two or more
          reviewers to run a multi-model consensus.
        </p>
      </div>

      <form className="nx-rev-form" onSubmit={submit} aria-label="Start a PR review">
        <div className="nx-rev-form-row">
          <input
            type="url"
            inputMode="url"
            placeholder="https://github.com/owner/repo/pull/123"
            aria-label="Pull request URL"
            className="nx-in mono"
            style={{ flex: 1 }}
            value={prUrl}
            onChange={(event) => setPrUrl(event.target.value)}
          />
          <Button type="submit" disabled={creatingReview || !prUrl.trim()} aria-label="Review pull request">
            {creatingReview ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <GitPullRequest data-icon="inline-start" />
            )}
            {creatingReview ? "Starting…" : consensus ? "Review with consensus" : "Review PR"}
          </Button>
        </div>
        {agentProfiles.length > 0 && (
          <div className="nx-rev-reviewers">
            <span className="nx-rl">Reviewers</span>
            {agentProfiles.map((profile) => {
              const on = selectedReviewerIds.includes(profile.id);
              return (
                <button
                  key={profile.id}
                  type="button"
                  className="nx-chip"
                  data-on={on}
                  aria-pressed={on}
                  onClick={() => toggleReviewer(profile.id)}
                >
                  <Check className="nx-check" aria-hidden="true" />
                  <AgentLogo agentKind={profile.agentKind} size="sm" />
                  {profile.name}
                </button>
              );
            })}
            {consensus && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 4, fontSize: 12, color: "var(--muted-foreground)" }}>
                Rounds
                <input
                  type="number"
                  min={MIN_ROUNDS}
                  max={MAX_ROUNDS}
                  aria-label="Consensus rounds"
                  className="nx-in"
                  style={{ width: 56, textAlign: "center" }}
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

      <div className="nx-rev-main">
        <div className="nx-rev-list" aria-label="PR review list">
          {prReviews.length === 0 ? (
            <p className="nx-rev-empty">No reviews yet. Paste a pull request link above to start one.</p>
          ) : (
            groupReviews(prReviews).map((section) => (
              <section key={section.key} className="nx-rev-sect" aria-label={section.label}>
                <h2>
                  {section.label}
                  <span className="nx-c">{section.reviews.length}</span>
                </h2>
                {section.reviews.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">Nothing here yet.</p>
                ) : (
                  section.reviews.map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      className="nx-rev-card"
                      data-active={review.id === selectedPrReviewId}
                      aria-pressed={review.id === selectedPrReviewId}
                      onClick={() => onSelectReview(review.id)}
                    >
                      <div className="nx-rev-card-top">
                        <PrReviewBadge review={review} />
                        {review.mode === "consensus" && (
                          <span className="nx-modeltag">{review.reviewers.length}-model</span>
                        )}
                        <span className="nx-num">#{review.prNumber}</span>
                      </div>
                      <div className="nx-rev-card-title">{review.prTitle ?? review.prUrl}</div>
                      <div className="nx-rev-card-meta">
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
            agentProfiles={agentProfiles}
            onRerun={onRerunReview}
            onDelete={onDeleteReview}
          />
        ) : (
          <section className="nx-rev-detail" aria-label="PR review">
            <div className="nx-rev-placeholder">
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
