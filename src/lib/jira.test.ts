import { describe, expect, it } from "vitest";
import { jiraBrowseUrl } from "./jira";

describe("jiraBrowseUrl", () => {
  it("builds the canonical browse URL from a bare site host", () => {
    expect(jiraBrowseUrl("acme.atlassian.net", "PROJ-1")).toBe(
      "https://acme.atlassian.net/browse/PROJ-1",
    );
  });

  it("normalizes a site that already includes a scheme or trailing slash", () => {
    expect(jiraBrowseUrl("https://acme.atlassian.net/", "SCRUM-2")).toBe(
      "https://acme.atlassian.net/browse/SCRUM-2",
    );
  });

  it("returns null when the site or key is missing", () => {
    expect(jiraBrowseUrl(null, "PROJ-1")).toBeNull();
    expect(jiraBrowseUrl("acme.atlassian.net", null)).toBeNull();
    expect(jiraBrowseUrl(undefined, undefined)).toBeNull();
  });
});
