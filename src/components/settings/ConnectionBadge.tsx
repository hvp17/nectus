import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "../ui/badge";

interface ConnectionBadgeProps {
  /** Drives the success/outline variant and the check/X icon. */
  connected: boolean;
  /** Visible (and spoken) status text, e.g. "Connected" / "Not installed". */
  label: string;
  /** Spoken prefix so the aria-label reads e.g. "GitHub Connected". */
  ariaPrefix: string;
}

/** The connection-status pill shared by the GitHub and JIRA settings cards. */
export function ConnectionBadge({ connected, label, ariaPrefix }: ConnectionBadgeProps) {
  return (
    <Badge
      variant={connected ? "success" : "outline"}
      className="gap-1.5"
      aria-label={`${ariaPrefix} ${label}`}
    >
      {connected ? (
        <CheckCircle2 size={13} className="text-status-success" />
      ) : (
        <XCircle size={13} className="text-muted-foreground" />
      )}
      {label}
    </Badge>
  );
}
