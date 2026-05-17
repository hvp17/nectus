import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "./ui/field";
import { Input } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Textarea } from "./ui/textarea";
import { AgentLogo, ModelLogo } from "./AgentBrand";
import { AgentProfile } from "../types";

interface CreateTaskModalProps {
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  agentProfiles: AgentProfile[];
  busy: boolean;

  newTaskTitle: string;
  setNewTaskTitle: (val: string) => void;
  newTaskPrompt: string;
  setNewTaskPrompt: (val: string) => void;
  newTaskBranchName: string;
  setNewTaskBranchName: (val: string) => void;
  newTaskHasWorktree: boolean;
  setNewTaskHasWorktree: (val: boolean) => void;
  defaultBranchPrefix?: string | null;
  newTaskAgentProfileId: number | undefined;
  setNewTaskAgentProfileId: (val: number) => void;
}

export function CreateTaskModal({
  onClose,
  onSubmit,
  agentProfiles,
  busy,
  newTaskTitle,
  setNewTaskTitle,
  newTaskPrompt,
  setNewTaskPrompt,
  newTaskBranchName,
  setNewTaskBranchName,
  newTaskHasWorktree,
  setNewTaskHasWorktree,
  defaultBranchPrefix,
  newTaskAgentProfileId,
  setNewTaskAgentProfileId,
}: CreateTaskModalProps) {
  const submitDisabled = busy || !newTaskAgentProfileId || (newTaskHasWorktree && !newTaskBranchName.trim());

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-48px)] max-w-xl gap-0 overflow-y-auto p-0">
        <form onSubmit={onSubmit}>
          <DialogHeader className="border-b p-6 pr-12">
            <div>
              <p className="eyebrow">Agent Setup</p>
              <DialogTitle className="text-xl font-bold tracking-tight">Create New Task</DialogTitle>
              <DialogDescription className="sr-only">
                Configure the agent profile, prompt, and git worktree for a new task.
              </DialogDescription>
            </div>
          </DialogHeader>

          <FieldGroup className="gap-6 p-6">
            <Field>
              <FieldLabel htmlFor="new-task-title">Title (Optional)</FieldLabel>
              <Input
                id="new-task-title"
                placeholder="Refactor auth logic..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="h-10"
              />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Choose Agent</FieldLegend>
              <RadioGroup
                value={newTaskAgentProfileId?.toString()}
                onValueChange={(value) => setNewTaskAgentProfileId(Number(value))}
                className="grid grid-cols-2 gap-3"
              >
                {agentProfiles.map((profile) => (
                  <FieldLabel key={profile.id} htmlFor={`agent-profile-${profile.id}`}>
                    <Field
                      orientation="horizontal"
                      data-checked={newTaskAgentProfileId === profile.id ? true : undefined}
                      className="items-center gap-3"
                    >
                      <RadioGroupItem id={`agent-profile-${profile.id}`} value={profile.id.toString()} />
                      <AgentLogo agentKind={profile.agentKind} size="md" className="agent-choice-logo" />
                      <FieldContent>
                        <FieldTitle>{profile.name}</FieldTitle>
                        <FieldDescription className="flex items-center gap-1.5">
                          <ModelLogo agentKind={profile.agentKind} model={profile.model} size="sm" />
                          {profile.model ?? "CLI default"}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor="new-task-prompt">Instructions (Optional)</FieldLabel>
              <Textarea
                id="new-task-prompt"
                value={newTaskPrompt}
                onChange={(e) => setNewTaskPrompt(e.target.value)}
                placeholder="What should the agent know before starting?"
                rows={4}
                className="min-h-[120px] resize-none"
              />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Git Integration</FieldLegend>
              <RadioGroup
                value={newTaskHasWorktree ? "worktree" : "direct"}
                onValueChange={(value) => {
                  const nextHasWorktree = value === "worktree";
                  setNewTaskHasWorktree(nextHasWorktree);
                  if (nextHasWorktree && !newTaskBranchName.trim() && defaultBranchPrefix) {
                    setNewTaskBranchName(defaultBranchPrefix);
                  }
                }}
                className="grid grid-cols-2 gap-3"
              >
                <FieldLabel htmlFor="task-mode-direct">
                  <Field orientation="horizontal" data-checked={!newTaskHasWorktree ? true : undefined}>
                    <RadioGroupItem id="task-mode-direct" value="direct" />
                    <FieldTitle>Direct Edit</FieldTitle>
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor="task-mode-worktree">
                  <Field orientation="horizontal" data-checked={newTaskHasWorktree ? true : undefined}>
                    <RadioGroupItem id="task-mode-worktree" value="worktree" />
                    <FieldTitle>New Worktree</FieldTitle>
                  </Field>
                </FieldLabel>
              </RadioGroup>
            </FieldSet>

            {newTaskHasWorktree && (
              <Field className="animate-in slide-in-from-top-2 duration-200">
                <FieldLabel htmlFor="new-task-branch">Branch Name</FieldLabel>
                <Input
                  id="new-task-branch"
                  placeholder={`${defaultBranchPrefix ?? "feat/"}refactor-auth`}
                  value={newTaskBranchName}
                  onChange={(e) => setNewTaskBranchName(e.target.value)}
                  className="h-10 font-mono text-xs"
                />
              </Field>
            )}
          </FieldGroup>

          <DialogFooter className="border-t bg-muted/20 p-6">
            <Button type="button" variant="ghost" size="lg" onClick={onClose} className="h-11">
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={submitDisabled} className="h-11 px-8 gap-2">
              <Plus data-icon="inline-start" />
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
