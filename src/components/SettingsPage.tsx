import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch, Github, Palette, Plus, Save, Terminal, XCircle } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import type { AgentProfile, AppSettings, AppSettingsInput, GithubStatus } from "../types";
import { ProfileEditor } from "./settings/ProfileEditor";
import {
  createProfileDraft,
  fallbackSettings,
  noDefaultProfileValue,
  normalizeProfileKindChange,
  profileDraftToInput,
  type ProfileDraft,
  toProfileDraft,
  toSettingsInput,
} from "./settings/profileDrafts";

interface SettingsPageProps {
  settings?: AppSettings;
  agentProfiles: AgentProfile[];
  githubStatus?: GithubStatus;
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
  githubStatus,
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
  const worktreePatternInvalid = !settingsDraft.defaultWorktreeRootPattern.includes("{repoName}");

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
    setProfileDrafts((current) => [...current, createProfileDraft()]);
  };

  const saveProfile = async (draft: ProfileDraft) => {
    await onSaveAgentProfile(profileDraftToInput(draft));
  };

  return (
    <section className="settings-page workspace p-10 overflow-auto mx-auto w-full">
      <header className="settings-hero">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        </div>
        <div className="settings-hero-actions">
          <Badge variant="secondary" aria-label={profileCountLabel}>{profileCountLabel}</Badge>
          <Button variant="outline" size="sm" onClick={onBack} className="h-9">
            Back to dashboard
          </Button>
        </div>
      </header>

      <div className="settings-overview" aria-label="Settings summary">
        <SettingsOverviewCard
          icon={selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal size={15} />}
          label="Default agent"
          value={selectedDefaultProfile?.name ?? "No default"}
        />
        <SettingsOverviewCard
          icon={<GitBranch size={15} />}
          label="Worktree root"
          value={settingsDraft.defaultWorktreeRootPattern || "Unset"}
          valueClassName="font-mono"
        />
        <SettingsOverviewCard icon={<Palette size={15} />} label="Interface" value={`${themeLabel} / ${densityLabel}`} />
      </div>

      <div className="settings-stack">
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-title">
              <h3>Agent Profiles</h3>
            </div>
            <div className="settings-section-actions">
              <Badge variant="outline">{profileCountLabel}</Badge>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
                <Plus data-icon="inline-start" />
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
                  <SelectGroup>
                    <SelectItem value={noDefaultProfileValue}>No default</SelectItem>
                    {defaultProfileOptions.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id!.toString()} textValue={profile.name}>
                        <span className="select-option-with-logo">
                          <AgentLogo agentKind={profile.agentKind} size="sm" />
                          {profile.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="profile-list">
              {profileDrafts.length === 0 ? (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Terminal />
                    </EmptyMedia>
                    <EmptyTitle>No agent profiles yet</EmptyTitle>
                    <EmptyDescription>Add a profile to choose which CLI agent runs your tasks.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
                      <Plus data-icon="inline-start" />
                      Add Profile
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                profileDrafts.map((profile, index) => (
                  <ProfileEditor
                    key={profile.id ?? `new-${index}`}
                    profile={profile}
                    isDefault={Boolean(profile.id && profile.id === settingsDraft.defaultAgentProfileId)}
                    busy={busy}
                    onChange={(patch) => updateProfileDraft(index, patch)}
                    onSave={() => saveProfile(profile)}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-title">
              <h3>Projects & Worktrees</h3>
            </div>
          </div>
          <FieldGroup className="settings-grid">
            <Field>
              <FieldLabel htmlFor="worktree-root-pattern">Worktree root pattern</FieldLabel>
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
                aria-invalid={worktreePatternInvalid}
                className="font-mono"
              />
              <FieldDescription>Use {"{repoName}"} to place each project in its own global worktree folder.</FieldDescription>
              {worktreePatternInvalid && <FieldError>Pattern must include {"{repoName}"} so each project gets its own folder.</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="branch-prefix">Default branch prefix</FieldLabel>
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
            </Field>
          </FieldGroup>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-title">
              <h3>GitHub</h3>
            </div>
          </div>
          <div className="settings-section-content">
            <GithubConnectionCard status={githubStatus} />
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-title">
              <h3>Appearance</h3>
            </div>
          </div>
          <FieldGroup className="settings-grid">
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
          </FieldGroup>
        </section>
      </div>

      <div className="settings-actions">
        <Button
          type="button"
          onClick={() => onSaveSettings(settingsDraft)}
          disabled={busy || worktreePatternInvalid}
          className="gap-2"
        >
          <Save data-icon="inline-start" />
          Save Settings
        </Button>
      </div>
    </section>
  );
}

function GithubConnectionCard({ status }: { status?: GithubStatus }) {
  if (!status) {
    return (
      <div className="default-agent-strip">
        <div className="default-agent-copy">
          <span className="settings-overview-icon">
            <Github size={15} />
          </span>
          <span>
            <strong>GitHub CLI</strong>
            <Skeleton className="mt-1 h-3 w-44" />
          </span>
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
    );
  }

  const connected = Boolean(status.installed && status.authenticated);
  const detail = !status.installed
    ? "Install the gh CLI to open pull requests from Nectus."
    : !status.authenticated
      ? "Run gh auth login in your terminal to connect."
      : `Connected as ${status.account ?? "your account"}.`;
  const badgeLabel = connected ? "Connected" : status.installed ? "Not signed in" : "Not installed";

  return (
    <div className="default-agent-strip">
      <div className="default-agent-copy">
        <span className="settings-overview-icon">
          <Github size={15} />
        </span>
        <span>
          <strong>GitHub CLI</strong>
          <small>{detail}</small>
        </span>
      </div>
      <Badge variant="outline" className="gap-1.5" aria-label={`GitHub ${badgeLabel}`}>
        {connected ? (
          <CheckCircle2 size={13} className="text-status-success" />
        ) : (
          <XCircle size={13} className="text-muted-foreground" />
        )}
        {badgeLabel}
      </Badge>
    </div>
  );
}

function SettingsOverviewCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card size="sm" className="settings-overview-item shadow-none">
      <CardContent className="settings-overview-content p-0">
        <span className="settings-overview-icon">{icon}</span>
        <span>
          <small>{label}</small>
          <strong className={valueClassName}>{value}</strong>
        </span>
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
    <FieldSet>
      <FieldLegend variant="label">{label}</FieldLegend>
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
    </FieldSet>
  );
}
