import { Github } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { ConnectionBadge } from "./ConnectionBadge";
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
        <ConnectionBadge connected={connected} label={badgeLabel} ariaPrefix="GitHub" />
      </span>
    </div>
  );
}
