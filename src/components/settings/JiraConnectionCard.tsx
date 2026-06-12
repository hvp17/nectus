import { useEffect, useState } from "react";
import { ExternalLink, KanbanSquare } from "lucide-react";
import { ConnectionBadge } from "./ConnectionBadge";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { openExternal } from "../../lib/openExternal";
import type { JiraRestStatus } from "../../types";

/** Where Atlassian Cloud users create personal API tokens. */
const API_TOKENS_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

interface JiraConnectionCardProps {
  status?: JiraRestStatus;
  /** Site detected from `acli jira auth status`, used to prefill when unconnected. */
  detectedSite?: string | null;
  busy: boolean;
  onSave: (site: string, email: string, token: string) => Promise<JiraRestStatus>;
  onDisconnect: () => Promise<void>;
}

/**
 * The recommended JIRA connection: a JIRA Cloud API token. It alone fully drives
 * the integration — board, sprints, legal transitions, every status column —
 * with the Atlassian CLI (`acli`) kept as the fallback connection. The token is
 * verified against `/myself`, then stored in the macOS Keychain — never in the
 * app database.
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

  const run = useGuardedAction(setError, setSaving);

  const save = () =>
    run(
      async () => {
        await onSave(site.trim(), email.trim(), token);
        setToken("");
      },
      { busy: true },
    );

  const disconnect = () =>
    run(
      async () => {
        await onDisconnect();
        setToken("");
      },
      { busy: true },
    );

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
            The recommended way to connect — drives the board, sprints, legal
            transitions, and every status column. Stored in your Keychain. Without a
            token, Nectus falls back to the Atlassian CLI (acli).
          </small>
        </span>
        <span className="nx-strip-right">
          <ConnectionBadge
            connected={connected}
            label={connected ? "Connected" : "Not connected"}
            ariaPrefix="JIRA REST"
          />
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
          Verified against /myself before it is saved.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </Field>

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={!canSave}>
          {connected ? "Update token" : "Test & connect"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => openExternal(API_TOKENS_URL)}
        >
          <ExternalLink className="size-4" />
          Create a token
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
