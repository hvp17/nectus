import { X, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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
  const submitDisabled =
    busy || !newTaskAgentProfileId || !newTaskPrompt.trim() || (newTaskHasWorktree && !newTaskBranchName.trim());

  return (
    <div className="modal-backdrop z-[100]" onMouseDown={onClose}>
      <form
        className="task-modal max-w-xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        onSubmit={onSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="task-modal-header p-6 border-b">
          <div>
            <p className="eyebrow">Agent Setup</p>
            <h3 className="text-xl font-bold tracking-tight">Create New Task</h3>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-8 w-8"
            title="Close"
          >
            <X size={18} />
          </Button>
        </div>

        <div className="task-modal-body p-6 space-y-6">
          <div className="field">
            <Label htmlFor="new-task-title" className="text-xs font-bold uppercase tracking-wider opacity-60">Title (Optional)</Label>
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
            <div className="choice-grid grid grid-cols-2 gap-3">
              {agentProfiles.map((profile) => (
                <label 
                  key={profile.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    newTaskAgentProfileId === profile.id 
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" 
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="agent-profile"
                    className="sr-only"
                    checked={newTaskAgentProfileId === profile.id}
                    onChange={() => setNewTaskAgentProfileId(profile.id)}
                  />
                  <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                    newTaskAgentProfileId === profile.id ? "border-primary" : "border-muted-foreground/30"
                  }`}>
                    {newTaskAgentProfileId === profile.id && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </div>
                  <span className="text-sm font-semibold">{profile.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <Label htmlFor="new-task-prompt" className="text-xs font-bold uppercase tracking-wider opacity-60">Instructions</Label>
            <textarea
              id="new-task-prompt"
              value={newTaskPrompt}
              onChange={(e) => setNewTaskPrompt(e.target.value)}
              placeholder="What should the agent accomplish?"
              rows={4}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px] resize-none"
            />
          </div>

          <div className="field">
            <Label className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2 block">Git Integration</Label>
            <div className="choice-grid grid grid-cols-2 gap-3">
              <label 
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  !newTaskHasWorktree 
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" 
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <input type="radio" className="sr-only" checked={!newTaskHasWorktree} onChange={() => setNewTaskHasWorktree(false)} />
                <span className="text-sm font-semibold">Direct Edit</span>
              </label>
              <label 
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  newTaskHasWorktree 
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" 
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={newTaskHasWorktree}
                  onChange={() => {
                    setNewTaskHasWorktree(true);
                    if (!newTaskBranchName.trim() && defaultBranchPrefix) {
                      setNewTaskBranchName(defaultBranchPrefix);
                    }
                  }}
                />
                <span className="text-sm font-semibold">New Worktree</span>
              </label>
            </div>
          </div>

          {newTaskHasWorktree && (
            <div className="field animate-in slide-in-from-top-2 duration-200">
              <Label htmlFor="new-task-branch" className="text-xs font-bold uppercase tracking-wider opacity-60">Branch Name</Label>
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

        <div className="task-modal-actions p-6 border-t flex justify-end gap-3 bg-muted/20">
          <Button type="button" variant="ghost" size="lg" onClick={onClose} className="h-11">
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={submitDisabled} className="h-11 px-8 gap-2">
            <Plus size={18} />
            Create Task
          </Button>
        </div>
      </form>
    </div>
  );
}
