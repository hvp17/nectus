import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import type { Repo } from "../types";

interface ProjectRowMenuProps {
  repo: Repo;
  busy: boolean;
  onRename: (repoId: number, name: string) => void;
  onRemove: (repoId: number) => void;
}

/**
 * Hover-revealed "⋯" menu on a sidebar project row: rename the display name or
 * remove the project from Nectus. Removal is refused by the backend while tasks
 * exist and never touches the repository on disk — the confirm copy says so.
 */
export function ProjectRowMenu({ repo, busy, onRename, onRemove }: ProjectRowMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(repo.name);

  const submitRename = () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (trimmed && trimmed !== repo.name) onRename(repo.id, trimmed);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            // Mirrors ProjectPanel's hover-revealed row-action recipe: reserves its
            // slot (opacity, not display) and reveals on row (`group/proj`) hover.
            className="group-hover/proj:opacity-100 ml-auto grid size-[18px] flex-none cursor-pointer place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity duration-[120ms] hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100"
            aria-label={`Project actions for ${repo.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal size={13} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() => {
              setName(repo.name);
              setRenaming(true);
            }}
          >
            <Pencil size={13} aria-hidden="true" />
            Rename project
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
            <Trash2 size={13} aria-hidden="true" />
            Remove project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm" onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              Display name only — the folder at {repo.path} is untouched.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Project name"
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {repo.name} from Nectus?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the project from Nectus — the repository on disk is untouched. A
              project that still has tasks cannot be removed; delete its tasks first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => onRemove(repo.id)}>
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
