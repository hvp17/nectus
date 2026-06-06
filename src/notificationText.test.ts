import { describe, expect, it } from "vitest";
import { NOTIFICATION_BODY_LIMIT, formatNotificationBody } from "./notificationText";

describe("formatNotificationBody", () => {
  it("collapses whitespace and trims", () => {
    expect(formatNotificationBody("  Wire   up\n auth  ")).toBe("Wire up auth");
  });

  it("strips bold, italic, and inline code markers", () => {
    expect(formatNotificationBody("**PR created** for `task` and *done*")).toBe(
      "PR created for task and done",
    );
  });

  it("keeps link text and drops the url", () => {
    expect(formatNotificationBody("Opened [pull/69](https://github.com/x/y/pull/69)")).toBe(
      "Opened pull/69",
    );
  });

  it("drops leading heading, bullet, and quote markers", () => {
    expect(formatNotificationBody("# Summary\n- first\n- second\n> note")).toBe(
      "Summary first second note",
    );
  });

  it("leaves snake_case identifiers and branch names intact", () => {
    expect(formatNotificationBody("ran review_loop on task_branch_1")).toBe(
      "ran review_loop on task_branch_1",
    );
  });

  it("truncates on a word boundary with an ellipsis", () => {
    const body = `${"word ".repeat(60)}tail`;
    const result = formatNotificationBody(body);

    expect(result.length).toBeLessThanOrEqual(NOTIFICATION_BODY_LIMIT);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain("wor…");
  });

  it("hard-cuts a single very long token", () => {
    const result = formatNotificationBody("x".repeat(400));

    expect(result.length).toBeLessThanOrEqual(NOTIFICATION_BODY_LIMIT);
    expect(result.endsWith("…")).toBe(true);
  });
});
