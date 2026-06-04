import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, GitBranch, Github, Palette, Plus, Save, Terminal, XCircle } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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

type SettingsSectionId = "profiles" | "projects" | "github" | "appearance";

export function SettingsPage({
  settings,
  agentProfiles,
  githubStatus,
  busy,
  onSaveSettings,
  onSaveAgentProfile,
}: SettingsPageProps) {
  const activeSettings = settings ?? fallbackSettings;
  const [settingsDraft, setSettingsDraft] = useState<AppSettingsInput>(() => toSettingsInput(activeSettings));
  const [profileDrafts, setProfileDrafts] = useState<ProfileDraft[]>(() => agentProfiles.map(toProfileDraft));
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("profiles");

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

  const navItems: { id: SettingsSectionId; icon: ReactNode; label: string; count?: string }[] = [
    { id: "profiles", icon: <Bot />, label: "Agent Profiles", count: String(profileDrafts.length) },
    { id: "projects", icon: <GitBranch />, label: "Projects & Worktrees" },
    { id: "github", icon: <Github />, label: "GitHub" },
    { id: "appearance", icon: <Palette />, label: "Appearance" },
  ];

  const goToSection = (id: SettingsSectionId) => {
    setActiveSection(id);
    document.getElementById(`settings-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
    <section className="nx-set">
      <nav className="nx-set-nav">
        <div className="nx-set-brand">
          <h1>Settings</h1>
          <p>Local · ~/.nectus</p>
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nx-set-navitem"
            data-active={activeSection === item.id}
            onClick={() => goToSection(item.id)}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="nx-count">{item.count}</span>}
          </button>
        ))}
      </nav>

      <div className="nx-set-body">
        <div className="nx-set-scroll">
        <div className="nx-set-overview" aria-label="Settings summary">
          <SettingsOverviewItem
            icon={selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal />}
            label="Default agent"
            value={selectedDefaultProfile?.name ?? "No default"}
          />
          <SettingsOverviewItem
            icon={<GitBranch />}
            label="Worktree root"
            value={settingsDraft.defaultWorktreeRootPattern || "Unset"}
            mono
          />
          <SettingsOverviewItem icon={<Palette />} label="Interface" value={`${themeLabel} / ${densityLabel}`} />
        </div>

        <section id="settings-section-profiles" className="nx-set-section">
          <div className="nx-set-sec-head">
            <Bot />
            <h3>Agent Profiles</h3>
            <div className="nx-set-sec-actions">
              <Badge variant="outline" aria-label={profileCountLabel}>{profileCountLabel}</Badge>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
                <Plus data-icon="inline-start" />
                Add Profile
              </Button>
            </div>
          </div>
          <div className="nx-set-sec-body">
            <div className="nx-strip">
              <span className="nx-strip-ic">
                {selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal />}
              </span>
              <span className="nx-strip-copy">
                <strong>Default agent</strong>
                <small>Used when a new task does not choose a specific profile.</small>
              </span>
              <span className="nx-strip-right">
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
              </span>
            </div>

            <div className="nx-set-list">
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

        <section id="settings-section-projects" className="nx-set-section">
          <div className="nx-set-sec-head">
            <GitBranch />
            <h3>Projects &amp; Worktrees</h3>
          </div>
          <div className="nx-set-sec-body">
            <FieldGroup className="nx-set-grid">
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
          </div>
        </section>

        <section id="settings-section-github" className="nx-set-section">
          <div className="nx-set-sec-head">
            <Github />
            <h3>GitHub</h3>
          </div>
          <div className="nx-set-sec-body">
            <GithubConnectionCard status={githubStatus} />
          </div>
        </section>

        <section id="settings-section-appearance" className="nx-set-section">
          <div className="nx-set-sec-head">
            <Palette />
            <h3>Appearance</h3>
          </div>
          <div className="nx-set-sec-body">
            <FieldGroup className="nx-set-grid">
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
          </div>
        </section>

        </div>
        <div className="nx-set-foot">
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
      </div>
    </section>
  );
}

function GithubConnectionCard({ status }: { status?: GithubStatus }) {
  if (!status) {
    return (
      <div className="nx-strip">
        <span className="nx-strip-ic">
          <Github />
        </span>
        <span className="nx-strip-copy">
          <strong>GitHub CLI</strong>
          <Skeleton className="mt-1 h-3 w-44" />
        </span>
        <span className="nx-strip-right">
          <Skeleton className="h-6 w-24" />
        </span>
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
    <div className="nx-strip">
      <span className="nx-strip-ic">
        <Github />
      </span>
      <span className="nx-strip-copy">
        <strong>GitHub CLI</strong>
        <small>{detail}</small>
      </span>
      <span className="nx-strip-right">
        <Badge variant={connected ? "success" : "outline"} className="gap-1.5" aria-label={`GitHub ${badgeLabel}`}>
          {connected ? (
            <CheckCircle2 size={13} className="text-status-success" />
          ) : (
            <XCircle size={13} className="text-muted-foreground" />
          )}
          {badgeLabel}
        </Badge>
      </span>
    </div>
  );
}

function SettingsOverviewItem({
  icon,
  label,
  value,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="nx-ov">
      <span className="nx-ov-ic">{icon}</span>
      <span>
        <small>{label}</small>
        <strong className={mono ? "mono" : undefined}>{value}</strong>
      </span>
    </div>
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
