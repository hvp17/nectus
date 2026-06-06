import { useEffect, useState } from "react";
import { CheckCircle2, KanbanSquare, XCircle } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import type { JiraRestStatus } from "../../types";

interface JiraConnectionCardProps {
  status?: JiraRestStatus;
  /** Site detected from `acli jira auth status`, used to prefill when unconnected. */
  detectedSite?: string | null;
  busy: boolean;
  onSave: (site: string, email: string, token: string) => Promise<JiraRestStatus>;
  onDisconnect: () => Promise<void>;
}

/**
 * Optional JIRA REST API-token connection. acli stays the base integration; this
 * token unlocks custom-workflow features (legal-transition dropdown, board status
 * filter, all status columns). The token is verified against `/myself`, then stored
 * in the macOS Keychain — never in the app database.
 */
export function JiraConnectionCard({
  status,
  detectedSite,
  busy,
  onSave,
  onDisconnect,
}: JiraConnectionCardProps) {
  const connected = Boolean(status?.connected);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill site/email from the connection status or acli-detected site whenever
  // they change (e.g. after connecting), without clobbering an in-progress edit.
  useEffect(() => {
    setSite((current) => current || status?.site || detectedSite || "");
    setEmail((current) => current || status?.email || "");
  }, [status?.site, status?.email, detectedSite]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await onSave(site.trim(), email.trim(), token);
      setToken("");
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setError(null);
    setSaving(true);
    try {
      await onDisconnect();
      setToken("");
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  };

  const disabled = busy || saving;
  const canSave = Boolean(site.trim() && email.trim() && token) && !disabled;

  return (
    <div className="nx-set-grid">
      <div className="nx-strip">
        <span className="nx-strip-ic">
          <KanbanSquare />
        </span>
        <span className="nx-strip-copy">
          <strong>JIRA API token</strong>
          <small>
            Optional. Unlocks custom workflow statuses — legal-transition moves, the
            board status filter, and every status column. Stored in your Keychain.
          </small>
        </span>
        <span className="nx-strip-right">
          <Badge
            variant={connected ? "success" : "outline"}
            className="gap-1.5"
            aria-label={`JIRA REST ${connected ? "Connected" : "Not connected"}`}
          >
            {connected ? (
              <CheckCircle2 size={13} className="text-status-success" />
            ) : (
              <XCircle size={13} className="text-muted-foreground" />
            )}
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </span>
      </div>

      <Field>
        <FieldLabel htmlFor="jira-rest-site">Site</FieldLabel>
        <Input
          id="jira-rest-site"
          value={site}
          onChange={(event) => setSite(event.target.value)}
          placeholder="your-team.atlassian.net"
          className="font-mono"
        />
        <FieldDescription>Your Atlassian Cloud host (no https://).</FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="jira-rest-email">Email</FieldLabel>
        <Input
          id="jira-rest-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="jira-rest-token">API token</FieldLabel>
        <Input
          id="jira-rest-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={connected ? "•••••••• (stored)" : "Paste an API token"}
          autoComplete="off"
        />
        <FieldDescription>
          Create one at id.atlassian.com/manage/api-tokens. Verified against /myself
          before it is saved.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </Field>

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={!canSave}>
          {connected ? "Update token" : "Test & connect"}
        </Button>
        {connected && (
          <Button type="button" variant="outline" onClick={disconnect} disabled={disabled}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
