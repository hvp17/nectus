import { type CSSProperties, lazy, Suspense, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  Minus,
  RefreshCw,
  ScanEye,
  Send,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { AgentLogo } from "./AgentBrand";
import { PrReviewBadge } from "./PrReviewBadge";
import { openExternal } from "../lib/openExternal";
import { PR_REVIEW_VERDICT_LABELS, prReviewVerdictKey } from "../statusLabels";
import { toast } from "sonner";
import type { AgentKind, AgentProfile, PrReview, PrReviewRun, PrReviewStatus, PrReviewVerdict } from "../types";

// Lazy so xterm only loads when a single review's Terminal view is opened, not in
// the Reviews-page chunk itself (mirrors the task workspace stage).
const ReviewTerminalPane = lazy(() =>
  import("./ReviewTerminalPane").then((module) => ({ default: module.ReviewTerminalPane })),
);

type DetailView = "review" | "terminal";

interface PrReviewDetailProps {
  review: PrReview;
  runs: PrReviewRun[];
  /** Live stdout of a single review's reviewer, shown in the read-only Terminal
   *  view. Empty for consensus reviews and between sessions. */
  liveReviewOutput?: string;
  agentProfiles: AgentProfile[];
  onRerun: (reviewId: number) => void;
  onDelete: (reviewId: number) => void;
  /** Post the finished review back to its pull request as a comment. */
  onPost: (reviewId: number) => Promise<unknown>;
}

interface RoundColumn {
  round: number;
  verdicts: Record<number, PrReviewVerdict>;
}

const inFlight = (status: PrReviewStatus) => status === "queued" || status === "reviewing";

/// Bucket a consensus review's flat run list into ascending per-round columns,
/// each holding the verdict every reviewer gave that round.
function groupRunsByRound(runs: PrReviewRun[]): RoundColumn[] {
  const byRound = new Map<number, Record<number, PrReviewVerdict>>();
  for (const run of runs) {
    const verdicts = byRound.get(run.round) ?? {};
    verdicts[run.reviewerProfileId] = run.verdict;
    byRound.set(run.round, verdicts);
  }
  return [...byRound.entries()].sort(([a], [b]) => a - b).map(([round, verdicts]) => ({ round, verdicts }));
}

export function PrReviewDetail({
  review,
  runs,
  liveReviewOutput = "",
  agentProfiles,
  onRerun,
  onDelete,
  onPost,
}: PrReviewDetailProps) {
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const isConsensus = review.mode === "consensus";
  const canShare = review.status === "ready" && !!review.reviewOutput;
  // Single reviews can flip between the rendered review and a read-only terminal
  // streaming the reviewer's stdout. Consensus keeps its round matrix (no toggle).
  const showTerminalToggle = !isConsensus && review.status !== "error";
  const [view, setView] = useState<DetailView>(() => (inFlight(review.status) ? "terminal" : "review"));

  // Reset the toggle when switching reviews: watch a running one live, read a
  // finished one's review.
  useEffect(() => {
    setView(inFlight(review.status) ? "terminal" : "review");
    // Only on selection change — a manual toggle must survive unrelated updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.id]);

  // When the selected review (re)enters reviewing, jump to the live terminal.
  useEffect(() => {
    if (inFlight(review.status)) setView("terminal");
  }, [review.status]);
  const agentKindFor = (profileId: number): AgentKind =>
    agentProfiles.find((profile) => profile.id === profileId)?.agentKind ?? "custom";

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
      // In the packaged webview writeText can reject (secure-context/permission);
      // tell the user instead of silently doing nothing.
      setCopied(false);
      toast.error("Couldn't copy review", {
        description: "Copying to the clipboard failed.",
      });
    }
  };

  const postToPr = async () => {
    setPosting(true);
    try {
      await onPost(review.id);
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="nx-rev-detail" aria-label="PR review">
      <header className="nx-rev-dhead">
        <div className="nx-rev-dtitle">
          <PrReviewBadge review={review} />
          {isConsensus && <span className="nx-modeltag">{review.reviewers.length}-model consensus</span>}
          <span className="nx-num">#{review.prNumber}</span>
          <span className="nx-t">{review.prTitle ?? review.prUrl}</span>
        </div>
        <div className="nx-rev-dmeta">
          <span>{review.repoName}</span>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.baseBranch && <span>base {review.baseBranch}</span>}
          {isConsensus && review.reviewers.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              Reviewers:
              {review.reviewers.map((reviewer) => (
                <span key={reviewer.reviewerProfileId} className="nx-rev-reviewer-pill">
                  <AgentLogo agentKind={agentKindFor(reviewer.reviewerProfileId)} size="sm" />
                  {(reviewer.reviewerName ?? "Reviewer").split(" ")[0]}
                </span>
              ))}
            </span>
          )}
          <a
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              // A plain target="_blank" does nothing in the Tauri webview; route
              // through the opener plugin (and surface a toast on failure).
              event.preventDefault();
              openExternal(review.prUrl);
            }}
          >
            Open PR <ExternalLink aria-hidden="true" />
          </a>
        </div>
        <div className="nx-rev-dactions">
          {showTerminalToggle && (
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => value && setView(value as DetailView)}
              variant="outline"
              className="mr-1"
            >
              <ToggleGroupItem value="review" aria-label="Show review" className="h-8 gap-1.5 px-2.5 text-xs">
                <ScanEye className="size-3.5" aria-hidden="true" />
                Review
              </ToggleGroupItem>
              <ToggleGroupItem value="terminal" aria-label="Show reviewer terminal" className="h-8 gap-1.5 px-2.5 text-xs">
                <TerminalSquare className="size-3.5" aria-hidden="true" />
                Terminal
                {inFlight(review.status) && <span className="dot live-dot bg-primary" aria-hidden="true" />}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
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
            variant="outline"
            disabled={!canShare}
            onClick={copyReview}
            aria-label="Copy review"
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : isConsensus ? "Copy consensus" : "Copy review"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canShare || posting}
            onClick={postToPr}
            aria-label="Post review to pull request"
          >
            {posting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
            {posting ? "Posting…" : "Post to PR"}
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

  function renderBody() {
    if (review.status === "error") {
      return (
        <Alert variant="destructive">
          <AlertTitle>Review failed</AlertTitle>
          <AlertDescription>{review.lastError ?? "Unknown error"}</AlertDescription>
        </Alert>
      );
    }

    if (isConsensus) {
      return <ConsensusBody review={review} rounds={groupRunsByRound(runs)} agentKindFor={agentKindFor} />;
    }

    // Single review, Terminal view: watch the reviewer's stdout stream live (and
    // the last run's output between sessions).
    if (view === "terminal") {
      return (
        <Suspense fallback={<div className="nx-rev-term-wrap" />}>
          <div className="nx-rev-term-wrap">
            <ReviewTerminalPane output={liveReviewOutput} active={inFlight(review.status)} />
          </div>
        </Suspense>
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

    return <div className="nx-rev-output">{review.reviewOutput ?? "The reviewer returned no output."}</div>;
  }
}

function ConsensusBody({
  review,
  rounds,
  agentKindFor,
}: {
  review: PrReview;
  rounds: RoundColumn[];
  agentKindFor: (profileId: number) => AgentKind;
}) {
  const ready = review.status === "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ConsensusBanner review={review} roundsShown={rounds.length} />

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
          {review.reviewers.map((reviewer) => (
            <div key={reviewer.reviewerProfileId} className="nx-matrix-row">
              <div className="nx-matrix-cell">
                <AgentLogo agentKind={agentKindFor(reviewer.reviewerProfileId)} size="sm" />
                <span className="nx-matrix-rev">
                  {reviewer.reviewerName ?? `Reviewer #${reviewer.reviewerProfileId}`}
                  {reviewer.reviewerProfileId === review.reviewerProfileId && (
                    <span className="sub"> · synthesizer</span>
                  )}
                </span>
              </div>
              {rounds.map((round) => {
                const verdict = round.verdicts[reviewer.reviewerProfileId];
                return (
                  <div key={round.round} className="nx-matrix-cell">
                    {verdict ? (
                      <>
                        <VDot verdict={verdict} />
                        <span className="nx-vlabel" data-v={verdict}>
                          {PR_REVIEW_VERDICT_LABELS[verdict].short}
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

function ConsensusBanner({ review, roundsShown }: { review: PrReview; roundsShown: number }) {
  const ready = review.status === "ready";

  if (!ready) {
    return (
      <div className="nx-cons-banner warn">
        <span className="nx-cb-ic">
          <LoaderCircle className="animate-spin" />
        </span>
        <div>
          <div className="nx-cb-t">
            {roundsShown === 0
              ? "Reviewers are reading the pull request"
              : `Reviewing — round ${roundsShown} of ${review.maxRounds ?? roundsShown}`}
          </div>
          <div className="nx-cb-d">
            {review.reviewers.length} reviewers compare notes each round and converge on a single verdict.
          </div>
        </div>
      </div>
    );
  }

  const verdictWord = PR_REVIEW_VERDICT_LABELS[prReviewVerdictKey(review.verdict)].long;
  const roundsDone = review.roundsCompleted || roundsShown;

  if (review.converged) {
    return (
      <div className="nx-cons-banner">
        <span className="nx-cb-ic">
          <CheckCircle2 />
        </span>
        <div>
          <div className="nx-cb-t">
            Converged in {roundsDone} round{roundsDone === 1 ? "" : "s"} — {verdictWord}
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
          Reviewers disagreed after {roundsDone} round{roundsDone === 1 ? "" : "s"}; the synthesizer used the majority
          position.
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
