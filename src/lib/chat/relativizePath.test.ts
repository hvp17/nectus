import { describe, it, expect } from "vitest";
import { relativizeCommand, relativizePath } from "./relativizePath";

const CWD = "/Users/tomas/.nectus/worktrees/nectus-desktop/task-abc";

describe("relativizePath", () => {
  it("strips the cwd prefix from a path under it", () => {
    expect(relativizePath(`${CWD}/src/types.ts`, CWD)).toBe("src/types.ts");
  });

  it("returns the basename when the path is the cwd itself", () => {
    expect(relativizePath(CWD, CWD)).toBe("task-abc");
  });

  it("tolerates a trailing slash on the cwd", () => {
    expect(relativizePath(`${CWD}/src/a.ts`, `${CWD}/`)).toBe("src/a.ts");
  });

  it("leaves a path outside the cwd untouched", () => {
    expect(relativizePath("/etc/hosts", CWD)).toBe("/etc/hosts");
  });

  it("does not strip a sibling worktree that merely shares the prefix", () => {
    expect(relativizePath(`${CWD}-other/src/a.ts`, CWD)).toBe(`${CWD}-other/src/a.ts`);
  });

  it("returns the original path when no cwd is known", () => {
    expect(relativizePath(`${CWD}/src/a.ts`, null)).toBe(`${CWD}/src/a.ts`);
    expect(relativizePath("a.ts", undefined)).toBe("a.ts");
  });
});

describe("relativizeCommand", () => {
  it("strips the cwd prefix from path args embedded in a command", () => {
    expect(relativizeCommand(`find ${CWD}/src/lib/chat -type f`, CWD)).toBe(
      "find src/lib/chat -type f",
    );
  });

  it("strips every occurrence", () => {
    expect(relativizeCommand(`grep -r "x" ${CWD}/src ${CWD}/native`, CWD)).toBe(
      'grep -r "x" src native',
    );
  });

  it("leaves a bare cwd token and sibling prefixes untouched", () => {
    expect(relativizeCommand(`ls ${CWD}-other/src`, CWD)).toBe(`ls ${CWD}-other/src`);
  });

  it("returns the command unchanged when no cwd is known", () => {
    expect(relativizeCommand("pnpm test", null)).toBe("pnpm test");
  });
});
