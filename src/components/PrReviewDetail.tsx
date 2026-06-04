import { type CSSProperties, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  Minus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { AgentLogo } from "./AgentBrand";
import { PrReviewBadge } from "./PrReviewBadge";
import type { PrReview, PrReviewConsensus, PrReviewStatus, PrReviewVerdict } from "../types";

interface PrReviewDetailProps {
  review: PrReview;
  runs: PrReviewRun[];
  onRerun: (reviewId: number) => void;
  onDelete: (reviewId: number) => void;
}

const inFlight = (status: PrReviewStatus) => status === "queued" || status === "reviewing";

function verdictLabel(verdict: PrReviewVerdict): string {
  return verdict === "passed" ? "Passed" : verdict === "blockers" ? "Blocking" : "Unsure";
}

export function PrReviewDetail({ review, onRerun, onDelete }: PrReviewDetailProps) {
  const [copied, setCopied] = useState(false);
  const consensus = review.consensus ?? undefined;

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
    <section className="nx-rev-detail" aria-label="PR review">
      <header className="nx-rev-dhead">
        <div className="nx-rev-dtitle">
          <PrReviewBadge review={review} />
          {consensus && <span className="nx-modeltag">{consensus.reviewers.length}-model consensus</span>}
          <span className="nx-num">#{review.prNumber}</span>
          <span className="nx-t">{review.prTitle ?? review.prUrl}</span>
        </div>
        <div className="nx-rev-dmeta">
          <span>{review.repoName}</span>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.baseBranch && <span>base {review.baseBranch}</span>}
          {consensus && (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              Reviewers:
              {consensus.reviewers.map((reviewer) => (
                <span key={reviewer.profileId} className="nx-rev-reviewer-pill">
                  <AgentLogo agentKind={reviewer.agentKind ?? "custom"} size="sm" />
                  {reviewer.name.split(" ")[0]}
                </span>
              ))}
            </span>
          )}
          <a href={review.prUrl} target="_blank" rel="noreferrer">
            Open PR <ExternalLink aria-hidden="true" />
          </a>
        </div>
        <div className="nx-rev-dactions">
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
            {copied ? "Copied" : consensus ? "Copy consensus" : "Copy review"}
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

      <div className="nx-rev-body">{renderBody()}</div>
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

    if (consensus) {
      return <ConsensusBody review={review} consensus={consensus} />;
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

    return <div className="nx-rev-output">{review.reviewOutput ?? "The reviewer returned no output."}</div>;
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

function ConsensusBody({ review, consensus }: { review: PrReview; consensus: PrReviewConsensus }) {
  const rounds = consensus.rounds;
  const ready = review.status === "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ConsensusBanner review={review} consensus={consensus} />

      {rounds.length > 0 && (
        <div className="nx-matrix" style={{ "--rounds": rounds.length } as CSSProperties}>
          <div className="nx-matrix-row head">
            <div className="nx-matrix-cell">Reviewer</div>
            {rounds.map((round) => (
              <div key={round.round} className="nx-matrix-cell">
                Round {round.round}
              </div>
            ))}
          </div>
          {consensus.reviewers.map((reviewer) => (
            <div key={reviewer.profileId} className="nx-matrix-row">
              <div className="nx-matrix-cell">
                <AgentLogo agentKind={reviewer.agentKind ?? "custom"} size="sm" />
                <span className="nx-matrix-rev">
                  {reviewer.name}
                  {reviewer.synthesizer && <span className="sub"> · synthesizer</span>}
                </span>
              </div>
              {rounds.map((round) => {
                const verdict = round.verdicts[String(reviewer.profileId)];
                return (
                  <div key={round.round} className="nx-matrix-cell">
                    {verdict ? (
                      <>
                        <VDot verdict={verdict} />
                        <span className="nx-vlabel" data-v={verdict}>
                          {verdictLabel(verdict)}
                        </span>
                      </>
                    ) : (
                      <span className="empty">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {ready && review.reviewOutput ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 className="nx-cons-h3">Consensus review</h3>
          <div className="nx-cons-out">{review.reviewOutput}</div>
        </section>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle size={14} className="animate-spin" />
          {rounds.length === 0 ? "Reviewers are reading the pull request…" : "Synthesizing the consensus review…"}
        </p>
      )}
    </div>
  );
}

function ConsensusBanner({ review, consensus }: { review: PrReview; consensus: PrReviewConsensus }) {
  const ready = review.status === "ready";

  if (!ready) {
    const round = consensus.rounds.length;
    return (
      <div className="nx-cons-banner warn">
        <span className="nx-cb-ic">
          <LoaderCircle className="animate-spin" />
        </span>
        <div>
          <div className="nx-cb-t">
            {round === 0
              ? "Reviewers are reading the pull request"
              : `Reviewing — round ${round} of ${consensus.maxRounds}`}
          </div>
          <div className="nx-cb-d">
            {consensus.reviewers.length} reviewers compare notes each round and converge on a single verdict.
          </div>
        </div>
      </div>
    );
  }

  const verdictWord =
    review.verdict === "passed" ? "Passed" : review.verdict === "blockers" ? "Blocking issues" : "Inconclusive";

  if (consensus.converged) {
    return (
      <div className="nx-cons-banner">
        <span className="nx-cb-ic">
          <CheckCircle2 />
        </span>
        <div>
          <div className="nx-cb-t">
            Converged in {consensus.convergedInRounds ?? consensus.rounds.length} round
            {(consensus.convergedInRounds ?? consensus.rounds.length) === 1 ? "" : "s"} — {verdictWord}
          </div>
          <div className="nx-cb-d">All reviewers agreed on the verdict. The synthesized review is below.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-cons-banner warn">
      <span className="nx-cb-ic">
        <AlertTriangle />
      </span>
      <div>
        <div className="nx-cb-t">Did not fully converge — {verdictWord}</div>
        <div className="nx-cb-d">
          Reviewers disagreed after {consensus.rounds.length} round
          {consensus.rounds.length === 1 ? "" : "s"}; the synthesizer used the majority position.
        </div>
      </div>
    </div>
  );
}

function VDot({ verdict }: { verdict: PrReviewVerdict }) {
  return (
    <span className="nx-vdot" data-v={verdict}>
      {verdict === "passed" ? <Check /> : verdict === "blockers" ? <X /> : <Minus />}
    </span>
  );
}
