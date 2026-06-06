import { useState } from "react";
import { CheckCircle2, GitMerge, LoaderCircle, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import type { MergeMethod, PullRequestInfo, TaskSummary } from "../../types";

interface PullRequestActionsProps {
  task: TaskSummary;
  /** The live PR; actions only render for an `open` PR (caller guards state). */
  pullRequest: PullRequestInfo;
  busy: boolean;
  onMerge: (task: TaskSummary, method: MergeMethod) => void;
  onSetReady: (task: TaskSummary) => void;
  onClose: (task: TaskSummary) => void;
}

/// Short pre-merge context from the data we already have. GitHub branch protection
/// is the real gate, so this informs rather than blocks.
function mergeContext(pr: PullRequestInfo): string {
  const parts: string[] = [];
  if (pr.reviewDecision === "approved") parts.push("Review approved");
  else if (pr.reviewDecision === "changes_requested") parts.push("Changes requested");
  else if (pr.reviewDecision === "review_required") parts.push("Review required");
  if (pr.checksState === "failing") parts.push("checks failing");
  else if (pr.checksState === "pending") parts.push("checks pending");
  else if (pr.checksState === "passing") parts.push("checks passing");
  const prefix = parts.length ? `${parts.join(" · ")}. ` : "";
  return `${prefix}GitHub enforces branch protection — a merge that isn't permitted will report why. The branch is not deleted.`;
}

/**
 * The ship actions for a task's open pull request: mark a draft ready, or merge /
 * close a ready PR. Merge and close confirm through an `AlertDialog`; merge also
 * picks the strategy. Shown only when `gh` is connected and the PR is `open`.
 */
export function PullRequestActions({ task, pullRequest, busy, onMerge, onSetReady, onClose }: PullRequestActionsProps) {
  if (pullRequest.isDraft) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        aria-label="Mark pull request ready for review"
        onClick={() => onSetReady(task)}
      >
        {busy ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <CheckCircle2 data-icon="inline-start" />
        )}
        Mark ready
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <MergeDialog task={task} pullRequest={pullRequest} busy={busy} onMerge={onMerge} />
      <CloseDialog task={task} pullRequest={pullRequest} busy={busy} onClose={onClose} />
    </div>
  );
}

function MergeDialog({
  task,
  pullRequest,
  busy,
  onMerge,
}: {
  task: TaskSummary;
  pullRequest: PullRequestInfo;
  busy: boolean;
  onMerge: (task: TaskSummary, method: MergeMethod) => void;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<MergeMethod>("squash");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" disabled={busy} aria-label="Merge pull request">
          {busy ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <GitMerge data-icon="inline-start" />
          )}
          Merge
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-status-success/10 text-status-success">
            <GitMerge />
          </AlertDialogMedia>
          <AlertDialogTitle>Merge pull request #{pullRequest.number}?</AlertDialogTitle>
          <AlertDialogDescription>{mergeContext(pullRequest)}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Method</span>
          <ToggleGroup
            type="single"
            variant="outline"
            value={method}
            onValueChange={(value) => value && setMethod(value as MergeMethod)}
            className="justify-start"
            aria-label="Merge method"
          >
            <ToggleGroupItem value="squash" className="px-3 text-xs" aria-label="Squash and merge">
              Squash
            </ToggleGroupItem>
            <ToggleGroupItem value="merge" className="px-3 text-xs" aria-label="Create a merge commit">
              Merge
            </ToggleGroupItem>
            <ToggleGroupItem value="rebase" className="px-3 text-xs" aria-label="Rebase and merge">
              Rebase
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onMerge(task, method);
            }}
          >
            Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CloseDialog({
  task,
  pullRequest,
  busy,
  onClose,
}: {
  task: TaskSummary;
  pullRequest: PullRequestInfo;
  busy: boolean;
  onClose: (task: TaskSummary) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-muted-foreground"
          aria-label="Close pull request"
        >
          <X data-icon="inline-start" />
          Close
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <X />
          </AlertDialogMedia>
          <AlertDialogTitle>Close pull request #{pullRequest.number}?</AlertDialogTitle>
          <AlertDialogDescription>
            This closes the pull request without merging it. You can reopen it on GitHub later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onClose(task);
            }}
          >
            Close PR
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
