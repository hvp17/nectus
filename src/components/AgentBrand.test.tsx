import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentLogo, ModelLogo } from "./AgentBrand";

describe("AgentBrand", () => {
  it("renders OpenCode as a first-class provider logo", () => {
    render(<AgentLogo agentKind="opencode" size="sm" />);

    expect(screen.getByRole("img", { name: "OpenCode logo" })).toBeInTheDocument();
  });

  it("maps opencode model ids to the OpenCode logo", () => {
    render(<ModelLogo agentKind="custom" model="opencode/gpt-5.1-codex" size="sm" />);

    expect(screen.getByRole("img", { name: "OpenCode logo" })).toBeInTheDocument();
  });
});
