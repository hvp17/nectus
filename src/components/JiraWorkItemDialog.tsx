import { useEffect, useState } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { AgentLogo } from "./AgentBrand";
import { JiraAvatar, JiraIssueTypeIcon } from "./jiraVisuals";
import { jiraBrowseUrl } from "../lib/jira";
import type { AgentProfile, JiraTransition, JiraWorkItem } from "../types";

export interface JiraWorkItemPanelProps {
  item: JiraWorkItem;
  statusOptions: string[];
  /** When a REST token is connected, the dropdown shows the issue's legal moves. */
  restConnected: boolean;
  onListTransitions: (key: string) => Promise<JiraTransition[]>;
  /** Connected JIRA site host, used to build the issue's browse URL. */
  site?: string | null;
  agentProfiles: AgentProfile[];
  /** Agent the launch row pre-selects; feeds the create-task composer. */
  selectedAgentProfileId?: number;
  onClose: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onAssign: (key: string, assignee: string) => void;
  onComment: (key: string, body: string) => void;
  onCreateTask: (item: JiraWorkItem) => void;
  onPickAgent: (profileId: number) => void;
  onOpenUrl: (url: string) => void;
}

/**
 * De-modaled JIRA work item: an inline side panel docked beside the board (the
 * board stays visible). Same fields/handlers as the old dialog, plus a bottom
 * launch row to go from story → running agent in one move.
 */
export function JiraWorkItemPanel({
  item,
  statusOptions,
  restConnected,
  onListTransitions,
  site,
  agentProfiles,
  selectedAgentProfileId,
  onClose,
  onTransition,
  onAssign,
  onComment,
  onCreateTask,
  onPickAgent,
  onOpenUrl,
}: JiraWorkItemPanelProps) {
  const [assignee, setAssignee] = useState("");
  const [comment, setComment] = useState("");
  const [restOptions, setRestOptions] = useState<string[] | null>(null);
  const browseUrl = jiraBrowseUrl(site, item.key);

  // With a token connected, fetch the issue's legal transitions on open so the
  // dropdown offers exactly the moves JIRA's (custom) workflow allows.
  useEffect(() => {
    if (!restConnected) {
      setRestOptions(null);
      return;
    }
    let alive = true;
    setRestOptions(null);
    onListTransitions(item.key)
      .then((transitions) => {
        if (alive) setRestOptions(transitions.map((transition) => transition.toStatusName));
      })
      .catch(() => {
        if (alive) setRestOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [restConnected, item.key, onListTransitions]);

  // Connected: the issue's legal transitions plus its current status (so the Select
  // always shows a value). Disconnected: the board-derived options, ensuring the
  // current status is selectable even when no other item shares it.
  const options = restConnected
    ? Array.from(new Set([item.statusName, ...(restOptions ?? [])]))
    : statusOptions.includes(item.statusName)
      ? statusOptions
      : [item.statusName, ...statusOptions];

  const launchAgentId = selectedAgentProfileId ?? agentProfiles[0]?.id;
  const launchAgent = agentProfiles.find((profile) => profile.id === launchAgentId);

  return (
    <aside
      className="flex min-w-0 flex-col overflow-hidden border-l bg-[color-mix(in_srgb,var(--card)_72%,var(--background))]"
      aria-label={`Work item ${item.key}`}
    >
      <div className="flex flex-col gap-2.5 border-b px-[18px] py-[15px]">
        <div className="flex items-center gap-2">
          <JiraIssueTypeIcon type={item.issueType} className="size-4 rounded-[5px]" />
          <Badge variant="secondary" className="font-mono">
            {item.key}
          </Badge>
          {item.issueType && <span className="text-xs font-medium text-muted-foreground">{item.issueType}</span>}
          <div className="ml-auto flex items-center gap-0.5">
            {browseUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => onOpenUrl(browseUrl)}
              >
                Open in JIRA
                <ExternalLink className="size-3.5" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close work item"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <h2 className="text-base font-bold leading-snug tracking-tight">{item.summary}</h2>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-4">
        <Field>
          <FieldLabel htmlFor="jira-status">Status</FieldLabel>
          <Select value={item.statusName} onValueChange={(value) => onTransition(item, value)}>
            <SelectTrigger id="jira-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {item.description && (
          <Field>
            <FieldLabel>Description</FieldLabel>
            <p className="max-h-[130px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="jira-assignee">Assignee</FieldLabel>
          <div className="flex items-center gap-2">
            <JiraAvatar name={item.assignee} className="shrink-0" />
            <Input
              id="jira-assignee"
              placeholder="user@example.com"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!assignee.trim()}
              onClick={() => {
                onAssign(item.key, assignee.trim());
                setAssignee("");
              }}
            >
              Assign
            </Button>
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-comment">Comment</FieldLabel>
          <Textarea
            id="jira-comment"
            rows={3}
            placeholder="Add a comment to this story..."
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={!comment.trim()}
              onClick={() => {
                onComment(item.key, comment.trim());
                setComment("");
              }}
            >
              Comment
            </Button>
          </div>
        </Field>
      </div>

      <div className="flex flex-col gap-2.5 border-t bg-muted/25 px-[18px] py-3.5">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
          Work this story
        </span>
        <div className="flex gap-2">
          {agentProfiles.length > 0 && (
            <Select
              value={launchAgentId?.toString()}
              onValueChange={(value) => onPickAgent(Number(value))}
            >
              <SelectTrigger aria-label="Agent for new task" className="h-9 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  {launchAgent && <AgentLogo agentKind={launchAgent.agentKind} size="sm" />}
                  <span className="truncate">{launchAgent?.name ?? "Choose an agent"}</span>
                </span>
              </SelectTrigger>
              <SelectContent position="popper">
                {agentProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id.toString()} textValue={profile.name}>
                    <span className="flex items-center gap-2">
                      <AgentLogo agentKind={profile.agentKind} size="sm" />
                      {profile.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" className="gap-2" onClick={() => onCreateTask(item)}>
            <Play className="size-4" />
            Create task &amp; start
          </Button>
        </div>
      </div>
    </aside>
  );
}
