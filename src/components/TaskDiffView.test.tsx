import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskDiffView } from "./TaskDiffView";
import type { FileDiffState } from "../hooks/useTaskDiff";
import type { TaskDiffSummary } from "../types";

const summary: TaskDiffSummary = {
  baseLabel: "origin/main",
  files: [
    { path: "src/a.ts", change: "modified", additions: 3, deletions: 1, binary: false },
    { path: "src/b.ts", change: "added", additions: 10, deletions: 0, binary: false },
  ],
};

function renderView(props: Partial<Omit<ComponentProps<typeof TaskDiffView>, "onSelectFile">> = {}) {
  const onSelectFile = vi.fn();
  const result = render(
    <TaskDiffView
      summary={props.summary === undefined ? summary : props.summary}
      loading={props.loading ?? false}
      error={props.error ?? null}
      files={props.files ?? {}}
      onSelectFile={onSelectFile}
    />,
  );
  return { onSelectFile, ...result };
}

describe("TaskDiffView", () => {
  it("lists changed files with counts and auto-loads the first file's patch", () => {
    const { onSelectFile } = renderView();
    expect(screen.getByText("Comparing against origin/main")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(onSelectFile).toHaveBeenCalledWith("src/a.ts");
  });

  it("colorizes patch lines by their leading character", () => {
    const files: Record<string, FileDiffState> = {
      "src/a.ts": {
        loading: false,
        patch: "@@ -1,2 +1,2 @@\n-old line\n+new line\n context",
      },
    };
    renderView({ files });
    expect(screen.getByText("+new line")).toHaveAttribute("data-line-type", "add");
    expect(screen.getByText("-old line")).toHaveAttribute("data-line-type", "del");
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toHaveAttribute("data-line-type", "hunk");
  });

  it("requests another file's patch when it is selected", () => {
    const { onSelectFile } = renderView();
    onSelectFile.mockClear();
    fireEvent.click(screen.getByText("b.ts"));
    expect(onSelectFile).toHaveBeenCalledWith("src/b.ts");
  });

  it("shows an empty state when nothing changed", () => {
    renderView({ summary: { baseLabel: "origin/main", files: [] } });
    expect(screen.getByText("No changes yet")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    renderView({ summary: null, error: "boom" });
    expect(screen.getByText("Could not load the diff")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("does not request a patch for a binary file", () => {
    const binarySummary: TaskDiffSummary = {
      baseLabel: "origin/main",
      files: [{ path: "logo.png", change: "added", additions: 0, deletions: 0, binary: true }],
    };
    const { onSelectFile } = renderView({ summary: binarySummary });
    expect(onSelectFile).not.toHaveBeenCalled();
    expect(screen.getByText("Binary file — no preview.")).toBeInTheDocument();
  });
});
