import { DownloadCloud, RefreshCw, RotateCw } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { UpdateInfo } from "../../lib/update";
import type { UpdateStatus } from "../../hooks/useAppUpdate";

interface UpdateCardProps {
  status: UpdateStatus;
  info: UpdateInfo | null;
  currentVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  onCheck: () => void;
  onInstall: () => void;
  onRelaunch: () => void;
}

function statusLabel(status: UpdateStatus): string {
  switch (status) {
    case "checking":
      return "Checking…";
    case "available":
      return "Update available";
    case "downloading":
      return "Downloading…";
    case "ready":
      return "Ready to relaunch";
    case "error":
      return "Check failed";
    case "upToDate":
      return "Up to date";
    default:
      return "Idle";
  }
}

/** The one-line detail under the title. Read top to bottom: first match wins. */
function detailMessage(
  status: UpdateStatus,
  info: UpdateInfo | null,
  percent: number | null,
  error: string | null,
  lastCheckedAt: number | null,
): string {
  if (status === "error" && error) {
    return error;
  }
  if (status === "downloading" && percent !== null) {
    return `Downloading version ${info?.version ?? ""}… ${percent}%`;
  }
  if (status === "available" && info) {
    return `Version ${info.version} is available.`;
  }
  if (status === "ready") {
    return "Update installed — relaunch to finish.";
  }
  if (lastCheckedAt) {
    return `Last checked ${new Date(lastCheckedAt).toLocaleTimeString()}.`;
  }
  return "Check GitHub for a newer version.";
}

export function UpdateCard({
  status,
  info,
  currentVersion,
  progress,
  error,
  lastCheckedAt,
  onCheck,
  onInstall,
  onRelaunch,
}: UpdateCardProps) {
  const busy = status === "checking" || status === "downloading";
  const percent = progress === null ? null : Math.round(progress * 100);
  const detail = detailMessage(status, info, percent, error, lastCheckedAt);

  return (
    <div className="nx-strip">
      <span className="nx-strip-ic">
        <DownloadCloud />
      </span>
      <span className="nx-strip-copy">
        <strong>Nectus Desktop {currentVersion ? `v${currentVersion}` : ""}</strong>
        <small>{detail}</small>
      </span>
      <span className="nx-strip-right">
        <Badge variant="outline" aria-label={`Update status: ${statusLabel(status)}`}>
          {statusLabel(status)}
        </Badge>
        {status === "available" && info ? (
          <Button type="button" size="sm" className="gap-2" onClick={onInstall}>
            <DownloadCloud data-icon="inline-start" />
            Install {info.version}
          </Button>
        ) : status === "ready" ? (
          <Button type="button" size="sm" className="gap-2" onClick={onRelaunch}>
            <RotateCw data-icon="inline-start" />
            Relaunch
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={busy}
            onClick={onCheck}
          >
            <RefreshCw data-icon="inline-start" />
            Check for updates
          </Button>
        )}
      </span>
    </div>
  );
}
