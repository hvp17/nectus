import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Save } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { AgentKind, AgentProfile, AppSettings, AppSettingsInput } from "../types";

const fallbackSettings: AppSettings = {
  defaultAgentProfileId: null,
  defaultWorktreeRootPattern: "../{repoName}-worktrees",
  defaultBranchPrefix: null,
  theme: "system",
  density: "comfortable",
  updatedAt: new Date(0).toISOString(),
};

const agentKindLabels: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  custom: "Custom",
};

const modelPresets: Record<AgentKind, string[]> = {
  codex: ["gpt-5.3-codex", "gpt-5.2"],
  claude: ["sonnet", "opus", "haiku"],
  gemini: ["gemini-pro", "gemini-flash"],
  custom: [],
};

interface ProfileDraft {
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

interface SettingsPageProps {
  settings?: AppSettings;
  agentProfiles: AgentProfile[];
  busy: boolean;
  onBack: () => void;
  onSaveSettings: (settings: AppSettingsInput) => Promise<unknown>;
  onSaveAgentProfile: (
    profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">,
  ) => Promise<AgentProfile>;
}

export function SettingsPage({
  settings,
  agentProfiles,
  busy,
  onBack,
  onSaveSettings,
  onSaveAgentProfile,
}: SettingsPageProps) {
  const activeSettings = settings ?? fallbackSettings;
  const [settingsDraft, setSettingsDraft] = useState<AppSettingsInput>(() => toSettingsInput(activeSettings));
  const [profileDrafts, setProfileDrafts] = useState<ProfileDraft[]>(() => agentProfiles.map(toProfileDraft));

  useEffect(() => {
    setSettingsDraft(toSettingsInput(activeSettings));
  }, [activeSettings]);

  useEffect(() => {
    setProfileDrafts(agentProfiles.map(toProfileDraft));
  }, [agentProfiles]);

  const defaultProfileOptions = useMemo(
    () => profileDrafts.filter((profile) => profile.id && profile.name.trim()),
    [profileDrafts],
  );

  const updateProfileDraft = (index: number, patch: Partial<ProfileDraft>) => {
    setProfileDrafts((current) =>
      current.map((profile, currentIndex) =>
        currentIndex === index
          ? normalizeProfileKindChange({
              ...profile,
              ...patch,
            })
          : profile,
      ),
    );
  };

  const addProfileDraft = () => {
    setProfileDrafts((current) => [
      ...current,
      {
        name: "New Agent",
        agentKind: "custom",
        command: "",
        model: "",
        customModel: "",
        argsText: "",
        envText: "",
      },
    ]);
  };

  const saveProfile = async (draft: ProfileDraft) => {
    const model = draft.model === "__custom" ? draft.customModel.trim() : draft.model;
    await onSaveAgentProfile({
      id: draft.id,
      name: draft.name.trim(),
      agentKind: draft.agentKind,
      command: draft.command.trim(),
      model: model || null,
      args: lines(draft.argsText),
      env: parseEnv(draft.envText),
      createdAt: draft.createdAt,
    });
  };

  return (
    <section className="settings-page workspace p-10 overflow-auto max-w-[1040px] mx-auto w-full">
      <header className="topbar">
        <div>
          <p className="eyebrow">Preferences</p>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        </div>
        <Button variant="outline" size="sm" onClick={onBack} className="h-9">
          Back to dashboard
        </Button>
      </header>

      <div className="settings-stack">
        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Agents</p>
              <h3>Agent Profiles</h3>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
              <Plus size={14} />
              Add Profile
            </Button>
          </div>
          <div className="settings-section-content">
            <div className="settings-field">
              <Label htmlFor="default-agent-profile">Default agent</Label>
              <select
                id="default-agent-profile"
                className="settings-select"
                value={settingsDraft.defaultAgentProfileId ?? ""}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    defaultAgentProfileId: event.target.value ? Number(event.target.value) : null,
                  }))
                }
              >
                <option value="">No default</option>
                {defaultProfileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="profile-list">
              {profileDrafts.map((profile, index) => (
                <ProfileEditor
                  key={profile.id ?? `new-${index}`}
                  profile={profile}
                  busy={busy}
                  onChange={(patch) => updateProfileDraft(index, patch)}
                  onSave={() => saveProfile(profile)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <p className="eyebrow">Repositories</p>
            <h3>Projects & Worktrees</h3>
          </div>
          <div className="settings-grid">
            <div className="settings-field">
              <Label htmlFor="worktree-root-pattern">Worktree root pattern</Label>
              <Input
                id="worktree-root-pattern"
                value={settingsDraft.defaultWorktreeRootPattern}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    defaultWorktreeRootPattern: event.target.value,
                  }))
                }
                placeholder="../{repoName}-worktrees"
                className="font-mono"
              />
              <p className="settings-help">Use {"{repoName}"} to place each project in its own global worktree folder.</p>
            </div>
            <div className="settings-field">
              <Label htmlFor="branch-prefix">Default branch prefix</Label>
              <Input
                id="branch-prefix"
                value={settingsDraft.defaultBranchPrefix ?? ""}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    defaultBranchPrefix: event.target.value || null,
                  }))
                }
                placeholder="feat/"
                className="font-mono"
              />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <p className="eyebrow">Interface</p>
            <h3>Appearance</h3>
          </div>
          <div className="settings-grid">
            <RadioGroup
              label="Theme"
              name="theme"
              value={settingsDraft.theme}
              options={[
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ]}
              onChange={(theme) => setSettingsDraft((current) => ({ ...current, theme }))}
            />
            <RadioGroup
              label="Density"
              name="density"
              value={settingsDraft.density}
              options={[
                ["comfortable", "Comfortable"],
                ["compact", "Compact"],
              ]}
              onChange={(density) => setSettingsDraft((current) => ({ ...current, density }))}
            />
          </div>
        </section>
      </div>

      <div className="settings-actions">
        <Button
          type="button"
          onClick={() => onSaveSettings(settingsDraft)}
          disabled={busy || !settingsDraft.defaultWorktreeRootPattern.includes("{repoName}")}
          className="gap-2"
        >
          <Save size={16} />
          Save Settings
        </Button>
      </div>
    </section>
  );
}

function ProfileEditor({
  profile,
  busy,
  onChange,
  onSave,
}: {
  profile: ProfileDraft;
  busy: boolean;
  onChange: (patch: Partial<ProfileDraft>) => void;
  onSave: () => void;
}) {
  const presets = modelPresets[profile.agentKind];
  const modelValue = profile.model && presets.includes(profile.model) ? profile.model : profile.model ? "__custom" : "";

  return (
    <div className="profile-editor">
      <div className="profile-editor-header">
        <div className="profile-kind-mark">{agentKindLabels[profile.agentKind].slice(0, 1)}</div>
        <div className="profile-title-fields">
          <Input
            aria-label="Profile name"
            value={profile.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="profile-name-input"
          />
          <select
            aria-label="Agent kind"
            className="settings-select"
            value={profile.agentKind}
            onChange={(event) => onChange({ agentKind: event.target.value as AgentKind })}
          >
            {Object.entries(agentKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" size="sm" className="gap-2" onClick={onSave} disabled={busy || !profile.name.trim() || !profile.command.trim()}>
          <Check size={14} />
          Save
        </Button>
      </div>

      <div className="profile-editor-grid">
        <div className="settings-field">
          <Label>Command</Label>
          <Input value={profile.command} onChange={(event) => onChange({ command: event.target.value })} className="font-mono" />
        </div>
        <div className="settings-field">
          <Label>Model</Label>
          <select
            className="settings-select"
            value={modelValue}
            onChange={(event) => {
              const value = event.target.value;
              onChange({ model: value, customModel: value === "__custom" ? profile.customModel : "" });
            }}
          >
            <option value="">CLI default</option>
            {presets.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
            <option value="__custom">Custom...</option>
          </select>
          {modelValue === "__custom" && (
            <Input
              aria-label="Custom model"
              value={profile.customModel}
              onChange={(event) => onChange({ customModel: event.target.value })}
              placeholder="model-id"
              className="mt-2 font-mono"
            />
          )}
        </div>
        <div className="settings-field">
          <Label>Args</Label>
          <textarea
            value={profile.argsText}
            onChange={(event) => onChange({ argsText: event.target.value })}
            placeholder="One CLI argument per line"
            className="settings-textarea font-mono"
          />
        </div>
        <div className="settings-field">
          <Label>Environment</Label>
          <textarea
            value={profile.envText}
            onChange={(event) => onChange({ envText: event.target.value })}
            placeholder="KEY=value"
            className="settings-textarea font-mono"
          />
        </div>
      </div>
    </div>
  );
}

function RadioGroup<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="settings-field">
      <legend className="settings-label">{label}</legend>
      <div className="segmented-options">
        {options.map(([optionValue, optionLabel]) => (
          <label key={optionValue} className={value === optionValue ? "segmented-option selected" : "segmented-option"}>
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function toSettingsInput(settings: AppSettings): AppSettingsInput {
  return {
    defaultAgentProfileId: settings.defaultAgentProfileId ?? null,
    defaultWorktreeRootPattern: settings.defaultWorktreeRootPattern,
    defaultBranchPrefix: settings.defaultBranchPrefix ?? null,
    theme: settings.theme,
    density: settings.density,
  };
}

function toProfileDraft(profile: AgentProfile): ProfileDraft {
  const presets = modelPresets[profile.agentKind];
  const model = profile.model ?? "";
  return {
    id: profile.id,
    name: profile.name,
    agentKind: profile.agentKind,
    command: profile.command,
    model: model && presets.includes(model) ? model : model ? "__custom" : "",
    customModel: model && presets.includes(model) ? "" : model,
    argsText: profile.args.join("\n"),
    envText: Object.entries(profile.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    createdAt: profile.createdAt,
  };
}

function normalizeProfileKindChange(profile: ProfileDraft): ProfileDraft {
  if (profile.agentKind === "custom") return profile;
  const presets = modelPresets[profile.agentKind];
  if (!profile.model || profile.model === "__custom" || presets.includes(profile.model)) return profile;
  return {
    ...profile,
    model: "__custom",
    customModel: profile.model,
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(value: string): Record<string, string> {
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
