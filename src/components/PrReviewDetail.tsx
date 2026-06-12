import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
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
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-card shadow-xs ring-1 ring-border"
      aria-label="PR review"
    >
      <header className="flex flex-none flex-col gap-[9px] border-b border-border px-[18px] py-4">
        <div className="flex items-center gap-[9px]">
          <PrReviewBadge review={review} />
          {isConsensus && (
            <span className="text-[9.5px] font-extrabold uppercase tracking-[0.05em] text-muted-foreground">
              {review.reviewers.length}-model consensus
            </span>
          )}
          <span className="font-mono text-[13px] font-bold text-muted-foreground">#{review.prNumber}</span>
          <span className="min-w-0 truncate text-[14.5px] font-bold tracking-[-0.01em]">
            {review.prTitle ?? review.prUrl}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          <span>{review.repoName}</span>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.baseBranch && <span>base {review.baseBranch}</span>}
          {isConsensus && review.reviewers.length > 0 && (
            <span className="flex items-center gap-[5px]">
              Reviewers:
              {review.reviewers.map((reviewer) => (
                <span
                  key={reviewer.reviewerProfileId}
                  className="inline-flex items-center gap-1 rounded-[5px] bg-muted px-1.5 py-px"
                >
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
            className="inline-flex cursor-pointer items-center gap-1 text-foreground no-underline hover:underline"
            onClick={(event) => {
              // A plain target="_blank" does nothing in the Tauri webview; route
              // through the opener plugin (and surface a toast on failure).
              event.preventDefault();
              openExternal(review.prUrl);
            }}
          >
            Open PR <ExternalLink className="size-[11px]" aria-hidden="true" />
          </a>
        </div>
        <div className="flex items-center gap-2 pt-[3px]">
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
                {inFlight(review.status) && (
                  <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                )}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">{renderBody()}</div>
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
      const termWrap = "h-full min-h-[320px] overflow-hidden rounded-[10px] border border-border bg-card";
      return (
        <Suspense fallback={<div className={termWrap} />}>
          <div className={termWrap}>
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

    return (
      <div className="whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-foreground [word-break:break-word]">
        {review.reviewOutput ?? "The reviewer returned no output."}
      </div>
    );
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
  const matrixRow = "grid items-stretch border-b border-border last:border-b-0";
  const matrixRowColumns = { gridTemplateColumns: `150px repeat(${rounds.length}, 1fr)` };
  const matrixCell =
    "flex min-w-0 items-center gap-[7px] border-l border-border px-3 py-[9px] text-[11.5px] first:border-l-0";
  const verdictLabelColor: Record<PrReviewVerdict, string> = {
    passed: "text-[color-mix(in_oklch,var(--status-success)_55%,var(--foreground))]",
    blockers: "text-[color-mix(in_oklch,var(--destructive)_62%,var(--foreground))]",
    inconclusive: "text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-4">
      <ConsensusBanner review={review} roundsShown={rounds.length} />

      {rounds.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn(matrixRow, "bg-muted/50")} style={matrixRowColumns}>
            {["Reviewer", ...rounds.map((round) => `Round ${round.round}`)].map((label) => (
              <div
                key={label}
                className={cn(matrixCell, "text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground")}
              >
                {label}
              </div>
            ))}
          </div>
          {review.reviewers.map((reviewer) => (
            <div key={reviewer.reviewerProfileId} className={matrixRow} style={matrixRowColumns}>
              <div className={matrixCell}>
                <AgentLogo agentKind={agentKindFor(reviewer.reviewerProfileId)} size="sm" />
                <span className="text-[12.5px] font-semibold text-foreground">
                  {reviewer.reviewerName ?? `Reviewer #${reviewer.reviewerProfileId}`}
                  {reviewer.reviewerProfileId === review.reviewerProfileId && (
                    <span className="text-[10.5px] font-medium text-muted-foreground"> · synthesizer</span>
                  )}
                </span>
              </div>
              {rounds.map((round) => {
                const verdict = round.verdicts[reviewer.reviewerProfileId];
                return (
                  <div key={round.round} className={matrixCell}>
                    {verdict ? (
                      <>
                        <VDot verdict={verdict} />
                        <span
                          className={cn("text-[11.5px] font-semibold", verdictLabelColor[verdict])}
                          data-v={verdict}
                        >
                          {PR_REVIEW_VERDICT_LABELS[verdict].short}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground opacity-40">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {ready && review.reviewOutput ? (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
            Consensus review
          </h3>
          <div className="whitespace-pre-wrap rounded-md border border-border bg-background px-[13px] py-[11px] font-mono text-[11.5px] leading-[1.6] text-foreground [word-break:break-word]">
            {review.reviewOutput}
          </div>
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

type BannerTone = "ok" | "warn" | "bad";

const bannerToneClasses: Record<BannerTone, { banner: string; icon: string }> = {
  ok: { banner: "border-status-success/38 bg-status-success/9", icon: "bg-status-success/16 text-status-success" },
  warn: { banner: "border-status-warning/40 bg-status-warning/9", icon: "bg-status-warning/16 text-status-warning" },
  bad: { banner: "border-destructive/40 bg-destructive/9", icon: "bg-destructive/16 text-destructive" },
};

function Banner({
  tone,
  icon,
  title,
  description,
}: {
  tone: BannerTone;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  const classes = bannerToneClasses[tone];
  return (
    <div className={cn("flex items-center gap-[13px] rounded-lg border px-4 py-3.5", classes.banner)}>
      <span
        className={cn("grid size-[34px] flex-none place-items-center rounded-full [&_svg]:size-[18px]", classes.icon)}
      >
        {icon}
      </span>
      <div>
        <div className="text-[13.5px] font-bold">{title}</div>
        <div className="mt-px text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function ConsensusBanner({ review, roundsShown }: { review: PrReview; roundsShown: number }) {
  const ready = review.status === "ready";

  if (!ready) {
    return (
      <Banner
        tone="warn"
        icon={<LoaderCircle className="animate-spin" />}
        title={
          roundsShown === 0
            ? "Reviewers are reading the pull request"
            : `Reviewing — round ${roundsShown} of ${review.maxRounds ?? roundsShown}`
        }
        description={`${review.reviewers.length} reviewers compare notes each round and converge on a single verdict.`}
      />
    );
  }

  const verdictWord = PR_REVIEW_VERDICT_LABELS[prReviewVerdictKey(review.verdict)].long;
  const roundsDone = review.roundsCompleted || roundsShown;

  if (review.converged) {
    return (
      <Banner
        tone="ok"
        icon={<CheckCircle2 />}
        title={`Converged in ${roundsDone} round${roundsDone === 1 ? "" : "s"} — ${verdictWord}`}
        description="All reviewers agreed on the verdict. The synthesized review is below."
      />
    );
  }

  return (
    <Banner
      tone="warn"
      icon={<AlertTriangle />}
      title={`Did not fully converge — ${verdictWord}`}
      description={`Reviewers disagreed after ${roundsDone} round${roundsDone === 1 ? "" : "s"}; the synthesizer used the majority position.`}
    />
  );
}

const verdictDotColor: Record<PrReviewVerdict, string> = {
  passed: "bg-status-success",
  blockers: "bg-destructive",
  inconclusive: "bg-muted-foreground",
};

function VDot({ verdict }: { verdict: PrReviewVerdict }) {
  return (
    <span
      className={cn(
        "grid size-[18px] flex-none place-items-center rounded-full [&_svg]:size-[11px] [&_svg]:text-primary-foreground",
        verdictDotColor[verdict],
      )}
      data-v={verdict}
    >
      {verdict === "passed" ? <Check /> : verdict === "blockers" ? <X /> : <Minus />}
    </span>
  );
}
