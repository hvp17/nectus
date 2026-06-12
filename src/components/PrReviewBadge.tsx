import {
  CircleCheck,
  CircleHelp,
  Loader,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { Badge, badgeVariants } from "./ui/badge";
import { cn } from "@/lib/utils";
import { PR_REVIEW_VERDICT_LABELS, prReviewVerdictKey } from "../statusLabels";
import type { PrReview, PrReviewVerdict } from "../types";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

interface BadgeSpec {
  label: string;
  variant: BadgeVariant;
  Icon: LucideIcon;
  /** Stable token for styling/testing hooks, independent of the label text. */
  tone: string;
  spin?: boolean;
}

/// Map a completed verdict (passed / blocking / inconclusive) to a badge. Shared
/// by the review badge's `ready` state and the per-reviewer consensus round cards.
function verdictBadgeSpec(verdict: PrReviewVerdict | null | undefined): BadgeSpec {
  const key = prReviewVerdictKey(verdict);
  const label = PR_REVIEW_VERDICT_LABELS[key].long;
  switch (key) {
    case "passed":
      return { label, variant: "success", Icon: CircleCheck, tone: key };
    case "blockers":
      return { label, variant: "destructive", Icon: TriangleAlert, tone: key };
    default:
      return { label, variant: "outline", Icon: CircleHelp, tone: key };
  }
}

/// Map a review's lifecycle + verdict to a single badge. A finished (`ready`)
/// review surfaces its verdict; the other statuses surface the lifecycle stage.
function badgeSpec(review: PrReview): BadgeSpec {
  switch (review.status) {
    case "queued":
      return { label: "Queued", variant: "outline", Icon: Loader, tone: "queued" };
    case "reviewing":
      return { label: "Reviewing", variant: "secondary", Icon: LoaderCircle, tone: "reviewing", spin: true };
    case "error":
      return { label: "Error", variant: "outline", Icon: TriangleAlert, tone: "error" };
    case "ready":
      return verdictBadgeSpec(review.verdict);
  }
}

function renderBadge(spec: BadgeSpec, dataAttrs: Record<string, string>, className?: string) {
  const { label, variant, Icon, spin } = spec;
  return (
    <Badge variant={variant} className={cn("rounded-md font-normal", className)} {...dataAttrs}>
      <Icon data-icon="inline-start" className={spin ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}

export function PrReviewBadge({ review, className }: { review: PrReview; className?: string }) {
  // Reviewing leads with a pulsing primary dot (not a spinner) to read as "live".
  if (review.status === "reviewing") {
    return (
      <Badge
        variant="outline"
        className={cn("rounded-md border-primary/40 bg-primary/10 font-normal text-primary", className)}
        data-pr-review-status="reviewing"
        data-pr-review-tone="reviewing"
      >
        <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-current" />
        Reviewing
      </Badge>
    );
  }
  const spec = badgeSpec(review);
  return renderBadge(
    spec,
    { "data-pr-review-status": review.status, "data-pr-review-tone": spec.tone },
    className,
  );
}

/// Standalone verdict badge for a single reviewer's consensus round output.
export function PrReviewVerdictBadge({
  verdict,
  className,
}: {
  verdict: PrReviewVerdict | null | undefined;
  className?: string;
}) {
  const spec = verdictBadgeSpec(verdict);
  return renderBadge(spec, { "data-pr-verdict-tone": spec.tone }, className);
}
