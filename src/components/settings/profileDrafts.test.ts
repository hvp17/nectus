import { describe, expect, it } from "vitest";
import type { AgentProfile } from "../../types";
import {
  createProfileDraft,
  normalizeProfileKindChange,
  parseEnv,
  profileDraftToInput,
  toProfileDraft,
} from "./profileDrafts";

const codexProfile: AgentProfile = {
  id: 1,
  name: "Codex",
  agentKind: "codex",
  command: "codex",
  model: "gpt-5.3-codex",
  args: ["--full-auto"],
  env: {
    OPENAI_BASE_URL: "https://api.example.test",
  },
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

describe("profile draft helpers", () => {
  it("round-trips saved profiles through editable drafts", () => {
    const draft = toProfileDraft(codexProfile);

    expect(draft).toMatchObject({
      id: codexProfile.id,
      name: codexProfile.name,
      agentKind: codexProfile.agentKind,
      command: codexProfile.command,
      model: "gpt-5.3-codex",
      customModel: "",
      argsText: "--full-auto",
      envText: "OPENAI_BASE_URL=https://api.example.test",
      createdAt: codexProfile.createdAt,
    });

    expect(profileDraftToInput(draft)).toEqual({
      id: codexProfile.id,
      name: codexProfile.name,
      agentKind: codexProfile.agentKind,
      command: codexProfile.command,
      model: "gpt-5.3-codex",
      args: ["--full-auto"],
      env: {
        OPENAI_BASE_URL: "https://api.example.test",
      },
      createdAt: codexProfile.createdAt,
    });
  });

  it("preserves custom model text when switching between non-custom agent kinds", () => {
    const draft = createProfileDraft();

    const normalized = normalizeProfileKindChange({
      ...draft,
      agentKind: "claude",
      model: "experimental-local-model",
    });

    expect(normalized.model).toBe("__custom");
    expect(normalized.customModel).toBe("experimental-local-model");
  });

  it("parses environment textarea lines without leaking malformed entries", () => {
    expect(parseEnv(" MODEL = fast \nmissing-separator\nEMPTY=\nTOKEN = abc=123 ")).toEqual({
      MODEL: "fast",
      EMPTY: "",
      TOKEN: "abc=123",
    });
  });
});
