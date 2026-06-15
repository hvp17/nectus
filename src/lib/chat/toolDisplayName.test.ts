import { describe, expect, it } from "vitest";
import { formatToolDisplayName } from "./toolDisplayName";

describe("formatToolDisplayName", () => {
  it("shortens MCP double-underscore tool ids", () => {
    expect(
      formatToolDisplayName(
        "mcp__claude_ai_Interactive_Brokers_IBKR__get_account_summary",
      ),
    ).toBe("Get account summary");
  });

  it("keeps short agent-authored titles", () => {
    expect(formatToolDisplayName("Read file", "read")).toBe("Read file");
  });

  it("humanizes snake_case suffixes", () => {
    expect(formatToolDisplayName("mcp__foo__list_open_orders")).toBe("List open orders");
  });

  it("falls back to kind when title is empty", () => {
    expect(formatToolDisplayName("  ", "execute")).toBe("execute");
  });
});
