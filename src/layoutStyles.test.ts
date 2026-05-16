/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), "styles.css");
const styles = readFileSync(stylesPath, "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationsFor(selector: string) {
  const match = styles.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1].replace(/\s+/g, " ").trim() ?? "";
}

describe("dashboard layout styles", () => {
  it("keeps the board scroll container bounded when the task detail pane is closed", () => {
    const dashboardLayout = declarationsFor(".dashboard-layout");
    const workspaceFrame = declarationsFor(".workspace-frame");

    expect(dashboardLayout).toContain("display: grid;");
    expect(dashboardLayout).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(dashboardLayout).toContain("height: 100vh;");
    expect(dashboardLayout).toContain("overflow: hidden;");
    expect(workspaceFrame).toContain("min-height: 0;");
    expect(workspaceFrame).toContain("overflow: auto;");
  });
});
