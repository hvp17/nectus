import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JiraAvatar, JiraIssueTypeIcon, JiraPriorityIcon } from "./jiraVisuals";

describe("jiraVisuals", () => {
  it("normalizes known JIRA issue type labels", () => {
    render(<JiraIssueTypeIcon type="Sub Task" />);

    expect(screen.getByLabelText("Sub-task")).toHaveAttribute("title", "Sub-task");
  });

  it("keeps unknown issue type names as their label", () => {
    render(<JiraIssueTypeIcon type="Spike" />);

    expect(screen.getByLabelText("Spike")).toHaveAttribute("title", "Spike");
  });

  it("renders priority labels only for known priorities", () => {
    const { rerender } = render(<JiraPriorityIcon priority="High" />);

    expect(screen.getByLabelText("Priority: High")).toHaveAttribute("title", "Priority: High");

    rerender(<JiraPriorityIcon priority="Not a priority" />);

    expect(screen.queryByLabelText(/Priority:/)).not.toBeInTheDocument();
  });

  it("renders deterministic initials and the unassigned state", () => {
    const { rerender } = render(<JiraAvatar name="Ada Lovelace" />);

    expect(screen.getByLabelText("Ada Lovelace")).toHaveTextContent("AL");

    rerender(<JiraAvatar name={null} />);

    expect(screen.getByLabelText("Unassigned")).toBeInTheDocument();
  });
});
