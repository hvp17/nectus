import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { commandText, toolGlyph, CommandStatusBadge } from "./toolGlyph";

describe("commandText", () => {
  it("reads a string rawInput", () => {
    expect(commandText("ls -la")).toBe("ls -la");
  });
  it("reads a { command } object (string or string[])", () => {
    expect(commandText({ command: "cargo test" })).toBe("cargo test");
    expect(commandText({ command: ["cargo", "test"] })).toBe("cargo test");
  });
  it("returns null for shapes it cannot read", () => {
    expect(commandText(null)).toBeNull();
    expect(commandText({ foo: 1 })).toBeNull();
  });
});

describe("toolGlyph", () => {
  it("renders an svg icon for a kind", () => {
    const { container } = render(<>{toolGlyph("execute", "completed")}</>);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("CommandStatusBadge", () => {
  it("labels success / failed / running", () => {
    const { rerender } = render(<CommandStatusBadge status="completed" />);
    expect(screen.getByText("Success")).toBeInTheDocument();
    rerender(<CommandStatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    rerender(<CommandStatusBadge status="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
