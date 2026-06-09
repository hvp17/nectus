import { describe, expect, it } from "vitest";
import { resolveAgentProfileId, resolveReviewerProfileId } from "./agentProfiles";

const profiles = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe("agent profile resolution", () => {
  it("uses the first available preferred profile id", () => {
    expect(resolveAgentProfileId(profiles, undefined, 2, 3)).toBe(2);
    expect(resolveAgentProfileId(profiles, null, 99, 3)).toBe(3);
  });

  it("falls back to the first profile when no preferred id is available", () => {
    expect(resolveAgentProfileId(profiles, 99)).toBe(1);
    expect(resolveAgentProfileId([], 99)).toBeUndefined();
  });

  it("prefers a reviewer that is not the worker agent when possible", () => {
    expect(resolveReviewerProfileId(profiles, 1)).toBe(2);
    expect(resolveReviewerProfileId([{ id: 1 }], 1)).toBe(1);
  });
});
