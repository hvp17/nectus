import { useEffect, useMemo, useState } from "react";
import { Check, Cpu, GitBranch, Palette, Plus, Save, Star, Terminal } from "lucide-react";
import { AgentLogo, ModelLogo } from "./AgentBrand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
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

const noDefaultProfileValue = "__none";
const cliDefaultModelValue = "__cli-default";
const customModelValue = "__custom";

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
  const selectedDefaultProfile = defaultProfileOptions.find(
    (profile) => profile.id === settingsDraft.defaultAgentProfileId,
  );
  const profileCountLabel = `${profileDrafts.length} ${profileDrafts.length === 1 ? "profile" : "profiles"}`;
  const themeLabel = settingsDraft.theme[0].toUpperCase() + settingsDraft.theme.slice(1);
  const densityLabel = settingsDraft.density[0].toUpperCase() + settingsDraft.density.slice(1);

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
    const model = draft.model === customModelValue ? draft.customModel.trim() : draft.model;
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
    <section className="settings-page workspace p-10 overflow-auto mx-auto w-full">
      <header className="settings-hero">
        <div>
          <p className="eyebrow">Preferences</p>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        </div>
        <div className="settings-hero-actions">
          <div className="settings-profile-count" aria-label={profileCountLabel}>
            <strong>{profileDrafts.length}</strong>
            <span>{profileDrafts.length === 1 ? "profile" : "profiles"}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onBack} className="h-9">
            Back to dashboard
          </Button>
        </div>
      </header>

      <div className="settings-overview" aria-label="Settings summary">
        <div className="settings-overview-item">
          <span className="settings-overview-icon">
            {selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal size={15} />}
          </span>
          <span>
            <small>Default agent</small>
            <strong>{selectedDefaultProfile?.name ?? "No default"}</strong>
          </span>
        </div>
        <div className="settings-overview-item">
          <span className="settings-overview-icon">
            <GitBranch size={15} />
          </span>
          <span>
            <small>Worktree root</small>
            <strong className="font-mono">{settingsDraft.defaultWorktreeRootPattern || "Unset"}</strong>
          </span>
        </div>
        <div className="settings-overview-item">
          <span className="settings-overview-icon">
            <Palette size={15} />
          </span>
          <span>
            <small>Interface</small>
            <strong>{themeLabel} / {densityLabel}</strong>
          </span>
        </div>
      </div>

      <div className="settings-stack">
        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Agents</p>
              <h3>Agent Profiles</h3>
            </div>
            <div className="settings-section-actions">
              <Badge variant="outline">{profileCountLabel}</Badge>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
                <Plus size={14} />
                Add Profile
              </Button>
            </div>
          </div>
          <div className="settings-section-content">
            <div className="default-agent-strip">
              <div className="default-agent-copy">
                <span className="settings-overview-icon">
                  {selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal size={15} />}
                </span>
                <span>
                  <strong>Default agent</strong>
                  <small>Used when a new task does not choose a specific profile.</small>
                </span>
              </div>
              <Select
                value={settingsDraft.defaultAgentProfileId?.toString() ?? noDefaultProfileValue}
                onValueChange={(value) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    defaultAgentProfileId: value === noDefaultProfileValue ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger id="default-agent-profile" aria-label="Default agent" className="h-9 w-full justify-between md:w-[280px]">
                  <span className="select-value-with-logo">
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={noDefaultProfileValue}>No default</SelectItem>
                  {defaultProfileOptions.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id!.toString()} textValue={profile.name}>
                      <span className="select-option-with-logo">
                        <AgentLogo agentKind={profile.agentKind} size="sm" />
                        {profile.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="profile-list">
              {profileDrafts.map((profile, index) => (
                <ProfileEditor
                  key={profile.id ?? `new-${index}`}
                  profile={profile}
                  isDefault={Boolean(profile.id && profile.id === settingsDraft.defaultAgentProfileId)}
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
            <SegmentedRadioGroup
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
            <SegmentedRadioGroup
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
  isDefault,
  busy,
  onChange,
  onSave,
}: {
  profile: ProfileDraft;
  isDefault: boolean;
  busy: boolean;
  onChange: (patch: Partial<ProfileDraft>) => void;
  onSave: () => void;
}) {
  const presets = modelPresets[profile.agentKind];
  const modelValue = profile.model && presets.includes(profile.model) ? profile.model : profile.model ? customModelValue : cliDefaultModelValue;
  const selectedModel = modelValue === customModelValue ? profile.customModel : modelValue === cliDefaultModelValue ? null : modelValue;
  const commandLabel = profile.command.trim() || "No command set";
  const modelLabel = selectedModel || "CLI default";
  const saveDisabled = busy || !profile.name.trim() || !profile.command.trim();

  return (
    <Card size="sm" className="profile-editor shadow-none" data-agent-kind={profile.agentKind}>
      <CardHeader className="profile-editor-header p-0">
        <div className="profile-identity">
          <AgentLogo agentKind={profile.agentKind} size="lg" className="profile-kind-mark" />
          <div className="profile-title-fields">
            <Input
              aria-label="Profile name"
              value={profile.name}
              onChange={(event) => onChange({ name: event.target.value })}
              className="profile-name-input"
            />
            <p className="profile-command-summary">
              <Terminal size={13} />
              <span className="font-mono">{commandLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{modelLabel}</span>
            </p>
          </div>
        </div>

        <div className="profile-editor-toolbar">
          <div className="profile-editor-badges">
            {isDefault && (
              <Badge variant="outline" className="profile-status-badge">
                <Star size={11} />
                Default
              </Badge>
            )}
            <Badge variant="outline" className="profile-status-badge">
              <AgentLogo agentKind={profile.agentKind} size="sm" />
              {agentKindLabels[profile.agentKind]}
            </Badge>
            <Badge variant="outline" className="profile-status-badge">
              <Cpu size={11} />
              {modelLabel}
            </Badge>
          </div>
          <Select value={profile.agentKind} onValueChange={(value) => onChange({ agentKind: value as AgentKind })}>
            <SelectTrigger aria-label="Agent kind" className="profile-kind-select h-8 justify-between">
              <span className="select-value-with-logo">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent position="popper">
              {Object.entries(agentKindLabels).map(([value, label]) => (
                <SelectItem key={value} value={value} textValue={label}>
                  <span className="select-option-with-logo">
                    <AgentLogo agentKind={value as AgentKind} size="sm" />
                    {label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="gap-2" onClick={onSave} disabled={saveDisabled}>
            <Check size={14} />
            Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="profile-editor-grid p-0">
        <div className="settings-field">
          <Label className="settings-field-label">
            <Terminal size={13} />
            Command
          </Label>
          <Input value={profile.command} onChange={(event) => onChange({ command: event.target.value })} className="font-mono" />
        </div>
        <div className="settings-field">
          <Label className="settings-field-label">
            <Cpu size={13} />
            Model
          </Label>
          <Select
            value={modelValue}
            onValueChange={(value) => {
              onChange({
                model: value === cliDefaultModelValue ? "" : value,
                customModel: value === customModelValue ? profile.customModel : "",
              });
            }}
          >
            <SelectTrigger className="h-8 w-full justify-between">
              <span className="select-value-with-logo">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={cliDefaultModelValue} textValue="CLI default">
                <span className="select-option-with-logo">
                  <ModelLogo agentKind={profile.agentKind} model={null} size="sm" />
                  CLI default
                </span>
              </SelectItem>
              {presets.map((preset) => (
                <SelectItem key={preset} value={preset} textValue={preset}>
                  <span className="select-option-with-logo">
                    <ModelLogo agentKind={profile.agentKind} model={preset} size="sm" />
                    {preset}
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={customModelValue} textValue="Custom...">
                <span className="select-option-with-logo">
                  <ModelLogo agentKind="custom" model={profile.customModel || "custom"} size="sm" />
                  Custom...
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          {modelValue === customModelValue && (
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
          <Label className="settings-field-label">
            <Terminal size={13} />
            Args
          </Label>
          <Textarea
            value={profile.argsText}
            onChange={(event) => onChange({ argsText: event.target.value })}
            placeholder="One CLI argument per line"
            className="min-h-[82px] resize-y font-mono"
          />
        </div>
        <div className="settings-field">
          <Label className="settings-field-label">
            <Cpu size={13} />
            Environment
          </Label>
          <Textarea
            value={profile.envText}
            onChange={(event) => onChange({ envText: event.target.value })}
            placeholder="KEY=value"
            className="min-h-[82px] resize-y font-mono"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SegmentedRadioGroup<T extends string>({
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
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue as T);
        }}
        variant="outline"
        className="flex-wrap"
      >
        {options.map(([optionValue, optionLabel]) => (
          <ToggleGroupItem
            key={optionValue}
            value={optionValue}
            aria-label={`${name} ${optionLabel}`}
            className="min-h-8 px-3"
          >
            {optionLabel}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
    model: model && presets.includes(model) ? model : model ? customModelValue : "",
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
  if (!profile.model || profile.model === customModelValue || presets.includes(profile.model)) return profile;
  return {
    ...profile,
    model: customModelValue,
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
