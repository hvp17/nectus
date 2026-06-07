import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

export interface EditableTaskTitleProps {
  title: string;
  onRename: (title: string) => void;
  className?: string;
}

/// The task header title rendered as click-to-edit. View mode is a button that
/// reveals a pencil on hover; clicking swaps in an inline input. Enter or blur
/// commits a trimmed, changed, non-empty title; Escape reverts. A ref guard
/// keeps the blur that follows an Enter commit from firing a second rename.
export function EditableTaskTitle({ title, onRename, className }: EditableTaskTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const editingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(title);
    editingRef.current = true;
    setEditing(true);
  };

  const commit = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
  };

  const cancel = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        aria-label="Task name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-md px-2.5 text-lg font-bold tracking-tight md:text-lg",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label="Rename task"
      title="Rename task"
      onClick={startEditing}
      className={cn(
        "group -mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60",
        className,
      )}
    >
      <span className="min-w-0 truncate text-lg font-bold tracking-tight">{title}</span>
      <Pencil
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}
