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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Textarea } from "./ui/textarea";
import { cn } from "../lib/utils";
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

          <div className="grid gap-6 p-6">
            <div className="field">
              <Label htmlFor="new-task-title" className="text-xs font-bold uppercase tracking-wider opacity-60">
                Title (Optional)
              </Label>
              <Input
                id="new-task-title"
                placeholder="Refactor auth logic..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="h-10"
              />
            </div>

            <div className="field">
              <Label className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2 block">Choose Agent</Label>
              <RadioGroup
                value={newTaskAgentProfileId?.toString()}
                onValueChange={(value) => setNewTaskAgentProfileId(Number(value))}
                className="grid grid-cols-2 gap-3"
              >
                {agentProfiles.map((profile) => (
                  <RadioChoice
                    key={profile.id}
                    htmlFor={`agent-profile-${profile.id}`}
                    checked={newTaskAgentProfileId === profile.id}
                  >
                    <RadioGroupItem id={`agent-profile-${profile.id}`} value={profile.id.toString()} />
                    {profile.name}
                  </RadioChoice>
                ))}
              </RadioGroup>
            </div>

            <div className="field">
              <Label htmlFor="new-task-prompt" className="text-xs font-bold uppercase tracking-wider opacity-60">
                Instructions (Optional)
              </Label>
              <Textarea
                id="new-task-prompt"
                value={newTaskPrompt}
                onChange={(e) => setNewTaskPrompt(e.target.value)}
                placeholder="What should the agent know before starting?"
                rows={4}
                className="min-h-[120px] resize-none"
              />
            </div>

            <div className="field">
              <Label className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2 block">Git Integration</Label>
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
                <RadioChoice htmlFor="task-mode-direct" checked={!newTaskHasWorktree}>
                  <RadioGroupItem id="task-mode-direct" value="direct" />
                  Direct Edit
                </RadioChoice>
                <RadioChoice htmlFor="task-mode-worktree" checked={newTaskHasWorktree}>
                  <RadioGroupItem id="task-mode-worktree" value="worktree" />
                  New Worktree
                </RadioChoice>
              </RadioGroup>
            </div>

            {newTaskHasWorktree && (
              <div className="field animate-in slide-in-from-top-2 duration-200">
                <Label htmlFor="new-task-branch" className="text-xs font-bold uppercase tracking-wider opacity-60">
                  Branch Name
                </Label>
                <Input
                  id="new-task-branch"
                  placeholder={`${defaultBranchPrefix ?? "feat/"}refactor-auth`}
                  value={newTaskBranchName}
                  onChange={(e) => setNewTaskBranchName(e.target.value)}
                  className="h-10 font-mono text-xs"
                />
              </div>
            )}
          </div>

          <DialogFooter className="border-t bg-muted/20 p-6">
            <Button type="button" variant="ghost" size="lg" onClick={onClose} className="h-11">
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={submitDisabled} className="h-11 px-8 gap-2">
              <Plus size={18} />
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RadioChoice({
  htmlFor,
  checked,
  children,
}: {
  htmlFor: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-semibold transition-all",
        checked ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border hover:bg-accent/50",
      )}
    >
      {children}
    </Label>
  );
}
