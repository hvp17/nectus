import type { AgentKind, AgentProfile, AppSettings, AppSettingsInput } from "../../types";

export const fallbackSettings: AppSettings = {
  defaultAgentProfileId: null,
  defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
  defaultBranchPrefix: null,
  jiraBoardJql: null,
  jiraSiteUrl: null,
  jiraBoardProject: null,
  jiraFilterMyIssues: false,
  jiraFilterUnresolved: true,
  jiraFilterCurrentSprint: false,
  jiraRestEmail: null,
  jiraFilterStatuses: [],
  persistentSessions: false,
  jiraFilterEpic: null,
  theme: "system",
  density: "comfortable",
  updatedAt: new Date(0).toISOString(),
};

export const agentKindLabels: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  custom: "Custom",
};

export const modelPresets: Record<AgentKind, string[]> = {
  codex: ["gpt-5.3-codex", "gpt-5.2"],
  claude: ["sonnet", "opus", "haiku"],
  antigravity: ["gemini-3.1-pro", "gemini-3.5-flash"],
  opencode: ["opencode/gpt-5.1-codex", "anthropic/claude-sonnet-4-5-20250929"],
  custom: [],
};

export const noDefaultProfileValue = "__none";
export const cliDefaultModelValue = "__cli-default";
export const customModelValue = "__custom";

export interface ProfileDraft {
  id?: number;
  name: string;
  agentKind: AgentKind;
  command: string;
  model: string;
  customModel: string;
  argsText: string;
  envText: string;
  createdAt?: string;
}

export function createProfileDraft(): ProfileDraft {
  return {
    name: "New Agent",
    agentKind: "custom",
    command: "",
    model: "",
    customModel: "",
    argsText: "",
    envText: "",
  };
}

export function toSettingsInput(settings: AppSettings): AppSettingsInput {
  return {
    defaultAgentProfileId: settings.defaultAgentProfileId ?? null,
    defaultWorktreeRootPattern: settings.defaultWorktreeRootPattern,
    defaultBranchPrefix: settings.defaultBranchPrefix ?? null,
    jiraBoardJql: settings.jiraBoardJql ?? null,
    jiraSiteUrl: settings.jiraSiteUrl ?? null,
    jiraBoardProject: settings.jiraBoardProject ?? null,
    jiraFilterMyIssues: settings.jiraFilterMyIssues,
    jiraFilterUnresolved: settings.jiraFilterUnresolved,
    jiraFilterCurrentSprint: settings.jiraFilterCurrentSprint,
    jiraFilterStatuses: settings.jiraFilterStatuses ?? [],
    persistentSessions: settings.persistentSessions,
    jiraFilterEpic: settings.jiraFilterEpic ?? null,
    theme: settings.theme,
    density: settings.density,
  };
}

export function toProfileDraft(profile: AgentProfile): ProfileDraft {
  const presets = modelPresets[profile.agentKind];
  const model = profile.model ?? "";
  // A saved model is either a known preset (shown in the dropdown), a free-text
  // custom value (dropdown shows "Custom", text kept in `customModel`), or empty.
  const isPreset = presets.includes(model);
  const isCustomModel = model !== "" && !isPreset;
  return {
    id: profile.id,
    name: profile.name,
    agentKind: profile.agentKind,
    command: profile.command,
    model: isPreset ? model : isCustomModel ? customModelValue : "",
    customModel: isCustomModel ? model : "",
    argsText: profile.args.join("\n"),
    envText: Object.entries(profile.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    createdAt: profile.createdAt,
  };
}

export function normalizeProfileKindChange(profile: ProfileDraft): ProfileDraft {
  if (profile.agentKind === "custom") return profile;
  const presets = modelPresets[profile.agentKind];
  if (!profile.model || profile.model === customModelValue || presets.includes(profile.model)) return profile;
  return {
    ...profile,
    model: customModelValue,
    customModel: profile.model,
  };
}

export function profileDraftToInput(
  draft: ProfileDraft,
): Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command"> {
  const model = draft.model === customModelValue ? draft.customModel.trim() : draft.model;
  return {
    id: draft.id,
    name: draft.name.trim(),
    agentKind: draft.agentKind,
    command: draft.command.trim(),
    model: model || null,
    args: lines(draft.argsText),
    env: parseEnv(draft.envText),
    createdAt: draft.createdAt,
  };
}

export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    lines(value)
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) return undefined;
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
}
