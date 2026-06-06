import { CheckCircle2, Github, XCircle } from "lucide-react";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { isCliConnected } from "../../lib/connection";
import type { GithubStatus } from "../../types";

export function GithubConnectionCard({ status }: { status?: GithubStatus }) {
  if (!status) {
    return (
      <div className="nx-strip">
        <span className="nx-strip-ic">
          <Github />
        </span>
        <span className="nx-strip-copy">
          <strong>GitHub CLI</strong>
          <Skeleton className="mt-1 h-3 w-44" />
        </span>
        <span className="nx-strip-right">
          <Skeleton className="h-6 w-24" />
        </span>
      </div>
    );
  }

  const connected = isCliConnected(status);
  const detail = !status.installed
    ? "Install the gh CLI to open pull requests from Nectus."
    : !status.authenticated
      ? "Run gh auth login in your terminal to connect."
      : `Connected as ${status.account ?? "your account"}.`;
  const badgeLabel = connected ? "Connected" : status.installed ? "Not signed in" : "Not installed";

  return (
    <div className="nx-strip">
      <span className="nx-strip-ic">
        <Github />
      </span>
      <span className="nx-strip-copy">
        <strong>GitHub CLI</strong>
        <small>{detail}</small>
      </span>
      <span className="nx-strip-right">
        <Badge variant={connected ? "success" : "outline"} className="gap-1.5" aria-label={`GitHub ${badgeLabel}`}>
          {connected ? (
            <CheckCircle2 size={13} className="text-status-success" />
          ) : (
            <XCircle size={13} className="text-muted-foreground" />
          )}
          {badgeLabel}
        </Badge>
      </span>
    </div>
  );
}
