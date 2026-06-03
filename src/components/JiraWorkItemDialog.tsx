import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
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
import { JiraAvatar, JiraIssueTypeIcon } from "./jiraVisuals";
import type { JiraWorkItem } from "../types";

interface JiraWorkItemDialogProps {
  item: JiraWorkItem | null;
  statusOptions: string[];
  onClose: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onAssign: (key: string, assignee: string) => void;
  onComment: (key: string, body: string) => void;
  onCreateTask: (item: JiraWorkItem) => void;
  onOpenUrl: (url: string) => void;
}

export function JiraWorkItemDialog({
  item,
  statusOptions,
  onClose,
  onTransition,
  onAssign,
  onComment,
  onCreateTask,
  onOpenUrl,
}: JiraWorkItemDialogProps) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-32px)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
        {item && (
          <JiraWorkItemDialogBody
            key={item.key}
            item={item}
            statusOptions={statusOptions}
            onTransition={onTransition}
            onAssign={onAssign}
            onComment={onComment}
            onCreateTask={onCreateTask}
            onOpenUrl={onOpenUrl}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type JiraWorkItemDialogBodyProps = Omit<JiraWorkItemDialogProps, "onClose" | "item"> & {
  item: JiraWorkItem;
};

function JiraWorkItemDialogBody({
  item,
  statusOptions,
  onTransition,
  onAssign,
  onComment,
  onCreateTask,
  onOpenUrl,
}: JiraWorkItemDialogBodyProps) {
  const [assignee, setAssignee] = useState("");
  const [comment, setComment] = useState("");

  // Ensure the current status is selectable even if it is not one of the
  // derived board columns (e.g. a status with no other items).
  const options = statusOptions.includes(item.statusName)
    ? statusOptions
    : [item.statusName, ...statusOptions];

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <JiraIssueTypeIcon type={item.issueType} className="size-5 rounded-md" />
          <Badge variant="secondary" className="font-mono">
            {item.key}
          </Badge>
          {item.issueType && (
            <span className="text-xs font-medium text-muted-foreground">{item.issueType}</span>
          )}
          {item.url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 text-xs"
              onClick={() => onOpenUrl(item.url as string)}
            >
              Open in JIRA
              <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
        <DialogTitle className="text-lg">{item.summary}</DialogTitle>
        <DialogDescription className="sr-only">
          Manage the JIRA work item {item.key}.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="jira-status">Status</FieldLabel>
          <Select
            value={item.statusName}
            onValueChange={(value) => onTransition(item, value)}
          >
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
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              {item.description}
            </p>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="jira-assignee" className="flex items-center gap-2">
            Assignee
            {item.assignee ? (
              <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
                <JiraAvatar name={item.assignee} className="size-4 text-[8px]" />
                {item.assignee}
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">· Unassigned</span>
            )}
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="jira-assignee"
              placeholder="user@example.com"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
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

      <DialogFooter>
        <Button type="button" className="gap-2" onClick={() => onCreateTask(item)}>
          <Plus className="size-4" />
          Create task from this story
        </Button>
      </DialogFooter>
    </>
  );
}
