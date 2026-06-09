import { describe, expect, it } from "vitest";
import { reviewTerminalOutputDelta } from "./reviewTerminalOutput";

describe("reviewTerminalOutputDelta", () => {
  it("appends only the new suffix when output grows from the rendered prefix", () => {
    expect(reviewTerminalOutputDelta("review line 1\n", "review line 1\nreview line 2\n")).toEqual({
      reset: false,
      chunk: "review line 2\n",
      renderedOutput: "review line 1\nreview line 2\n",
    });
  });

  it("does nothing when output has already been rendered", () => {
    expect(reviewTerminalOutputDelta("done\n", "done\n")).toEqual({
      reset: false,
      chunk: "",
      renderedOutput: "done\n",
    });
  });

  it("resets and replays when output is replaced at the same length", () => {
    expect(reviewTerminalOutputDelta("old\n", "new\n")).toEqual({
      reset: true,
      chunk: "new\n",
      renderedOutput: "new\n",
    });
  });

  it("resets and replays when output shrinks", () => {
    expect(reviewTerminalOutputDelta("first\nsecond\n", "first\n")).toEqual({
      reset: true,
      chunk: "first\n",
      renderedOutput: "first\n",
    });
  });
});
