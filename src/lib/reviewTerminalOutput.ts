interface ReviewTerminalOutputDelta {
  reset: boolean;
  chunk: string;
  renderedOutput: string;
}

export function reviewTerminalOutputDelta(
  renderedOutput: string,
  nextOutput: string,
): ReviewTerminalOutputDelta {
  if (nextOutput.startsWith(renderedOutput)) {
    return {
      reset: false,
      chunk: nextOutput.slice(renderedOutput.length),
      renderedOutput: nextOutput,
    };
  }

  return {
    reset: renderedOutput.length > 0,
    chunk: nextOutput,
    renderedOutput: nextOutput,
  };
}
