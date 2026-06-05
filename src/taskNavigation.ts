export type AppView = "mission" | "board" | "settings" | "reviews" | "jira";

export interface TaskFocusPlan {
  // Repo to select, or undefined to leave the current selection alone.
  repoId?: number;
  // View to land on. A task workspace only renders over Mission Control or the
  // board, so any secondary view is routed to the board.
  view: "mission" | "board";
  // Whether to close the New Task composer, which otherwise overlays the
  // viewport and hides the task workspace.
  dismissComposer: boolean;
}

// Decides how to surface a task's workspace from anywhere in the app (board,
// Mission Control, JIRA card, or an attention toast).
export function planTaskFocus(
  view: AppView,
  task: { repoId: number } | undefined,
  composerOpen: boolean,
): TaskFocusPlan {
  return {
    repoId: task?.repoId,
    view: view === "mission" || view === "board" ? view : "board",
    dismissComposer: composerOpen,
  };
}
