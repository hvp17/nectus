import { ArrowLeft, GitBranch, Play, TerminalSquare } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { AgentLogo } from "./AgentBrand";
import { cn } from "../lib/utils";
import { AgentProfile, Repo } from "../types";

interface CreateTaskComposerProps {
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  agentProfiles: AgentProfile[];
  repos: Repo[];
  busy: boolean;

  newTaskTitle: string;
  setNewTaskTitle: (val: string) => void;
  newTaskPrompt: string;
  setNewTaskPrompt: (val: string) => void;
  newTaskBranchName: string;
  setNewTaskBranchName: (val: string) => void;
  newTaskHasWorktree: boolean;
  setNewTaskHasWorktree: (val: boolean) => void;
  suggestedBranchName: string;
  newTaskAgentProfileId: number | undefined;
  setNewTaskAgentProfileId: (val: number) => void;
  newTaskRepoId: number | undefined;
  setNewTaskRepoId: (val: number) => void;
  linkedJiraKey?: string | null;
}

/**
 * De-modaled "New Task": a focused inline composer view (≤620px) reached from the
 * board's New Task action. Same fields, form state, and create logic as before —
 * the modal framing is gone.
 */
export function CreateTaskComposer({
  onClose,
  onSubmit,
  agentProfiles,
  repos,
  busy,
  newTaskTitle,
  setNewTaskTitle,
  newTaskPrompt,
  setNewTaskPrompt,
  newTaskBranchName,
  setNewTaskBranchName,
  newTaskHasWorktree,
  setNewTaskHasWorktree,
  suggestedBranchName,
  newTaskAgentProfileId,
  setNewTaskAgentProfileId,
  newTaskRepoId,
  setNewTaskRepoId,
  linkedJiraKey,
}: CreateTaskComposerProps) {
  const submitDisabled = busy || !newTaskAgentProfileId || !newTaskRepoId;
  const selectedRepo = repos.find((repo) => repo.id === newTaskRepoId);
  const selectedAgent = agentProfiles.find((profile) => profile.id === newTaskAgentProfileId);
  const repoLabel = selectedRepo?.name ?? "Board";

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-6 py-7"
      role="region"
      aria-label="New task composer"
    >
      <form onSubmit={onSubmit} className="flex w-full max-w-[620px] flex-col gap-[18px]">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onClose}
            className="mb-1.5 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {repoLabel}
          </button>
          <h1 className="text-[25px] font-bold tracking-tight">New Task</h1>
          <p className="text-[13px] text-muted-foreground">
            Launch an agent against {repoLabel} on its own branch.
          </p>
          {linkedJiraKey && (
            <Badge variant="secondary" className="mt-1.5 w-fit font-mono">
              Linked to {linkedJiraKey}
            </Badge>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm">
          <Field>
            <FieldLabel htmlFor="new-task-title">Title (Optional)</FieldLabel>
            <Input
              id="new-task-title"
              placeholder="What should the agent do?"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              className="h-10"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="new-task-prompt">Prompt (Optional)</FieldLabel>
            <Textarea
              id="new-task-prompt"
              value={newTaskPrompt}
              onChange={(e) => setNewTaskPrompt(e.target.value)}
              placeholder="Describe the task in detail. Sent to the agent on start."
              rows={4}
              className="min-h-[112px] resize-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-task-repo">Project</FieldLabel>
              <Select value={newTaskRepoId?.toString()} onValueChange={(value) => setNewTaskRepoId(Number(value))}>
                <SelectTrigger id="new-task-repo" className="h-10" aria-label="Project">
                  <span className="flex min-w-0 items-center gap-2">
                    <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                    <SelectValue placeholder="Choose a project" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id.toString()}>
                      {repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="new-task-agent">Agent</FieldLabel>
              <Select
                value={newTaskAgentProfileId?.toString()}
                onValueChange={(value) => setNewTaskAgentProfileId(Number(value))}
              >
                <SelectTrigger id="new-task-agent" className="h-10" aria-label="Agent">
                  <span className="flex min-w-0 items-center gap-2">
                    {selectedAgent && <AgentLogo agentKind={selectedAgent.agentKind} size="sm" />}
                    <SelectValue placeholder="Choose an agent" />
                  </span>
                </SelectTrigger>
                <SelectContent>
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
            </Field>
          </div>

          <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3.5 py-3">
            <div className="min-w-0">
              <strong className="block text-[13px] font-semibold">Create a git worktree</strong>
              <small className="block text-[11.5px] text-muted-foreground">
                Isolate this task on its own branch.
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={newTaskHasWorktree}
              aria-label="Create a git worktree"
              onClick={() => setNewTaskHasWorktree(!newTaskHasWorktree)}
              className={cn(
                "relative ml-auto h-[22px] w-[38px] shrink-0 rounded-full transition-colors",
                newTaskHasWorktree ? "bg-primary" : "bg-muted-foreground/40",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white shadow-sm transition-transform",
                  newTaskHasWorktree && "translate-x-4",
                )}
              />
            </button>
          </div>

          {newTaskHasWorktree && (
            <Field className="animate-in slide-in-from-top-2 duration-200">
              <FieldLabel htmlFor="new-task-branch" className="flex items-center gap-1.5">
                <GitBranch className="size-3.5 opacity-70" aria-hidden="true" />
                Branch name (Optional)
              </FieldLabel>
              <Input
                id="new-task-branch"
                placeholder={suggestedBranchName}
                value={newTaskBranchName}
                onChange={(e) => setNewTaskBranchName(e.target.value)}
                className="h-10 font-mono text-xs"
              />
              <FieldDescription>Blank generates a {"task-…"} branch with the configured prefix.</FieldDescription>
            </Field>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <TerminalSquare className="size-3.5" aria-hidden="true" />
            {newTaskHasWorktree
              ? "Creates the worktree and starts the agent immediately."
              : "Starts the agent in the project immediately."}
          </span>
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitDisabled} className="gap-2">
            <Play data-icon="inline-start" fill="currentColor" />
            Create &amp; Start
          </Button>
        </div>
      </form>
    </div>
  );
}
