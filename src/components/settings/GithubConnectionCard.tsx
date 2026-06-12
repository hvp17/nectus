import { Github } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item";
import { Skeleton } from "../ui/skeleton";
import { ConnectionBadge } from "./ConnectionBadge";
import { isCliConnected } from "../../lib/connection";
import type { GithubStatus } from "../../types";

export function GithubConnectionCard({ status }: { status?: GithubStatus }) {
  if (!status) {
    return (
      <Item variant="muted">
        <ItemMedia variant="icon" className="size-8 rounded-md bg-card text-muted-foreground shadow-xs">
          <Github />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-[13px]">GitHub CLI</ItemTitle>
          <Skeleton className="h-3 w-44" />
        </ItemContent>
        <ItemActions>
          <Skeleton className="h-6 w-24" />
        </ItemActions>
      </Item>
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
    <Item variant="muted">
      <ItemMedia variant="icon" className="size-8 rounded-md bg-card text-muted-foreground shadow-xs">
        <Github />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-[13px]">GitHub CLI</ItemTitle>
        <ItemDescription>{detail}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ConnectionBadge connected={connected} label={badgeLabel} ariaPrefix="GitHub" />
      </ItemActions>
    </Item>
  );
}
