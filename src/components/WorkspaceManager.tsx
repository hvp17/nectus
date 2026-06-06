import { useEffect, useState } from "react";
import { ArrowLeft, FolderGit2, Layers, Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import type { Repo, Workspace } from "../types";

type EditingTarget = number | "new";

interface WorkspaceManagerProps {
  workspaces: Workspace[];
  repos: Repo[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, repoIds: number[]) => Promise<unknown>;
  onUpdate: (id: number, name: string, repoIds: number[]) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}

/**
 * De-modaled workspace manager: a focused inline composer (matching
 * `CreateTaskComposer`) to create, rename, re-scope, and delete the named repo
 * groups that drive the workspace filter. Reached from the workspace switcher.
 */
export function WorkspaceManager({
  workspaces,
  repos,
  busy,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: WorkspaceManagerProps) {
  const [editingId, setEditingId] = useState<EditingTarget>("new");
  const [name, setName] = useState("");
  const [repoIds, setRepoIds] = useState<number[]>([]);

  // Seed the form from the selected target. Re-runs on `workspaces` so an edit
  // re-syncs after a save refreshes the list from the backend.
  useEffect(() => {
    if (editingId === "new") {
      setName("");
      setRepoIds([]);
      return;
    }
    const workspace = workspaces.find((item) => item.id === editingId);
    setName(workspace?.name ?? "");
    setRepoIds(workspace ? [...workspace.repoIds] : []);
  }, [editingId, workspaces]);

  const toggleRepo = (id: number, on: boolean) =>
    setRepoIds((current) => (on ? [...current, id] : current.filter((value) => value !== id)));

  const submit = async () => {
    try {
      if (editingId === "new") {
        await onCreate(name, repoIds);
      } else {
        await onUpdate(editingId, name, repoIds);
      }
      onClose();
    } catch {
      // The action surfaced the failure via a toast; keep the form open to retry.
    }
  };

  const remove = async (id: number) => {
    try {
      await onDelete(id);
      setEditingId("new");
    } catch {
      // Failure already surfaced via a toast; leave the form as-is.
    }
  };

  const saveDisabled = busy || !name.trim();

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-6 py-[26px]"
      role="region"
      aria-label="Workspace manager"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex w-full max-w-[620px] flex-col gap-[18px]"
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onClose}
            className="mb-1.5 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back
          </button>
          <h1 className="text-[25px] font-bold tracking-tight">Workspaces</h1>
          <p className="text-[13px] text-muted-foreground">
            Group repos you work on together, then filter Mission Control and the board to a workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Edit workspace">
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              type="button"
              size="sm"
              variant={editingId === workspace.id ? "default" : "outline"}
              onClick={() => setEditingId(workspace.id)}
            >
              <Layers data-icon="inline-start" />
              {workspace.name}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={editingId === "new" ? "default" : "outline"}
            onClick={() => setEditingId("new")}
          >
            <Plus data-icon="inline-start" />
            New workspace
          </Button>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card px-[22px] py-5 shadow-sm">
          <Field>
            <FieldLabel htmlFor="workspace-name" className="text-[11px] font-bold tracking-[0.02em]">
              Name
            </FieldLabel>
            <Input
              id="workspace-name"
              placeholder="e.g. Payments stack"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-[34px]"
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-bold tracking-[0.02em]">Repositories</legend>
            {repos.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Add a local git project first.</p>
            ) : (
              repos.map((repo) => (
                <label
                  key={repo.id}
                  className="flex items-center gap-3 rounded-md border bg-muted/20 px-3.5 py-2.5"
                >
                  <FolderGit2 className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{repo.name}</span>
                  <Switch
                    checked={repoIds.includes(repo.id)}
                    onCheckedChange={(on) => toggleRepo(repo.id, on)}
                    aria-label={repo.name}
                  />
                </label>
              ))
            )}
          </fieldset>
        </div>

        <div className="flex items-center gap-3">
          {editingId !== "new" && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove(editingId)}
              disabled={busy}
            >
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saveDisabled}>
            {editingId === "new" ? "Create workspace" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
