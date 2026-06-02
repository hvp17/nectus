import {
  CircleCheck,
  CircleHelp,
  Clock,
  LoaderCircle,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { Badge, badgeVariants } from "./ui/badge";
import { cn } from "@/lib/utils";
import type { PrReview } from "../types";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

interface BadgeSpec {
  label: string;
  variant: BadgeVariant;
  Icon: LucideIcon;
  /** Stable token for styling/testing hooks, independent of the label text. */
  tone: string;
  spin?: boolean;
}

/// Map a review's lifecycle + verdict to a single badge. A finished (`ready`)
/// review surfaces its verdict (passed / blocking / inconclusive); the other
/// statuses surface the lifecycle stage directly.
function badgeSpec(review: PrReview): BadgeSpec {
  switch (review.status) {
    case "queued":
      return { label: "Queued", variant: "outline", Icon: Clock, tone: "queued" };
    case "reviewing":
      return { label: "Reviewing", variant: "secondary", Icon: LoaderCircle, tone: "reviewing", spin: true };
    case "error":
      return { label: "Error", variant: "outline", Icon: TriangleAlert, tone: "error" };
    case "ready":
      switch (review.verdict) {
        case "passed":
          return { label: "Passed", variant: "secondary", Icon: CircleCheck, tone: "passed" };
        case "blockers":
          return { label: "Blocking issues", variant: "destructive", Icon: OctagonAlert, tone: "blockers" };
        default:
          return { label: "Inconclusive", variant: "outline", Icon: CircleHelp, tone: "inconclusive" };
      }
  }
}

export function PrReviewBadge({ review, className }: { review: PrReview; className?: string }) {
  const { label, variant, Icon, tone, spin } = badgeSpec(review);
  return (
    <Badge
      variant={variant}
      className={cn("rounded-md font-normal", className)}
      data-pr-review-status={review.status}
      data-pr-review-tone={tone}
    >
      <Icon data-icon="inline-start" className={spin ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}
