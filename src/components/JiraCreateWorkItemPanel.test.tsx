import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { JiraProject } from "../types";
import { JiraCreateWorkItemPanel } from "./JiraCreateWorkItemPanel";

const projects: JiraProject[] = [
  { key: "ENG", name: "Engineering" },
  { key: "OPS", name: "Operations" },
];

function renderPanel({
  panelProjects = projects,
  defaultProject = "ENG",
  onCreate = vi.fn(async () => null),
}: {
  panelProjects?: JiraProject[];
  defaultProject?: string | null;
  onCreate?: ComponentProps<typeof JiraCreateWorkItemPanel>["onCreate"];
} = {}) {
  const props = {
    projects: panelProjects,
    defaultProject,
    onClose: vi.fn(),
    onCreate,
  };
  const view = renderWithTooltipProvider(<JiraCreateWorkItemPanel {...props} />);
  return { ...view, props };
}

it("adopts the default project when projects load after mount", async () => {
  const onCreate = vi.fn(async () => null);
  const { rerender, props } = renderPanel({ panelProjects: [], defaultProject: null, onCreate });

  fireEvent.change(screen.getByLabelText("Summary"), {
    target: { value: "Document release flow" },
  });

  expect(screen.getByRole("button", { name: /create work item/i })).toBeDisabled();

  rerender(<JiraCreateWorkItemPanel {...props} projects={projects} defaultProject="ENG" />);

  const createButton = screen.getByRole("button", { name: /create work item/i });
  expect(createButton).toBeEnabled();

  fireEvent.click(createButton);

  await waitFor(() =>
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "ENG",
        summary: "Document release flow",
      }),
    ),
  );
});
