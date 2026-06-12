import { useState } from "react";
import { Plus, X } from "lucide-react";
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
import { JiraIssueTypeIcon } from "./jiraVisuals";
import type { JiraProject, JiraWorkItem } from "../types";

/**
 * Work item types offered by the create form, and the canonical default set for
 * the JIRA integration. Nectus does not enumerate a project's configured types,
 * so this is the common default list; an invalid type for a project surfaces as
 * a JIRA error (the optimistic pattern used across the JIRA integration).
 */
export const JIRA_WORK_ITEM_TYPES = ["Task", "Bug", "Story", "Epic"] as const;

export interface JiraCreateWorkItemPanelProps {
  projects: JiraProject[];
  /** The board's selected project, used as the default destination. */
  defaultProject: string | null;
  onClose: () => void;
  /** Creates the item in JIRA; resolves to the new item, or null on failure. */
  onCreate: (input: {
    project: string;
    issueType: string;
    summary: string;
    description?: string;
    assignee?: string;
    labels?: string;
  }) => Promise<JiraWorkItem | null>;
}

/**
 * Inline "new work item" form docked in the board's right-hand panel slot (no
 * modal, matching the de-modaled JIRA surfaces). On success the parent swaps this
 * for the new item's view panel; on failure the entered values are kept for retry.
 */
export function JiraCreateWorkItemPanel({
  projects,
  defaultProject,
  onClose,
  onCreate,
}: JiraCreateWorkItemPanelProps) {
  const defaultProjectKey = defaultProject ?? projects[0]?.key ?? "";
  const [project, setProject] = useState(defaultProjectKey);
  const [issueType, setIssueType] = useState<string>(JIRA_WORK_ITEM_TYPES[0]);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!project && defaultProjectKey) {
    setProject(defaultProjectKey);
  }

  const canSubmit = Boolean(project) && summary.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate({
        project,
        issueType,
        summary: summary.trim(),
        description: description.trim() || undefined,
        assignee: assignee.trim() || undefined,
        labels: labels.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside
      className="flex min-w-0 flex-col overflow-hidden border-l bg-[color-mix(in_srgb,var(--card)_72%,var(--background))]"
      aria-label="New work item"
      data-testid="jira-create-panel"
    >
      <div className="flex items-center gap-2 border-b px-[18px] py-[15px]">
        <JiraIssueTypeIcon type={issueType} className="size-4 rounded-[5px]" />
        <h2 className="text-base font-bold leading-snug tracking-tight">New work item</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close new work item"
          className="ml-auto"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-4">
        <Field>
          <FieldLabel htmlFor="jira-new-project">Project</FieldLabel>
          <Select value={project || undefined} onValueChange={setProject}>
            <SelectTrigger id="jira-new-project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name} ({option.key})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-new-type">Type</FieldLabel>
          <Select value={issueType} onValueChange={setIssueType}>
            <SelectTrigger id="jira-new-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JIRA_WORK_ITEM_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  <span className="flex items-center gap-2">
                    <JiraIssueTypeIcon type={type} className="size-3.5 rounded-[4px]" />
                    {type}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-new-summary">Summary</FieldLabel>
          <Input
            id="jira-new-summary"
            placeholder="Short, descriptive title"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            autoFocus
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-new-description">Description</FieldLabel>
          <Textarea
            id="jira-new-description"
            rows={4}
            placeholder="Add detail, acceptance criteria, repro steps..."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-new-assignee">Assignee</FieldLabel>
          <Input
            id="jira-new-assignee"
            placeholder="user@example.com or @me"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="jira-new-labels">Labels</FieldLabel>
          <Input
            id="jira-new-labels"
            placeholder="comma, separated, labels"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-muted/25 px-[18px] py-3.5">
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" className="gap-2" disabled={!canSubmit} onClick={submit}>
          <Plus className="size-4" />
          {submitting ? "Creating..." : "Create work item"}
        </Button>
      </div>
    </aside>
  );
}
