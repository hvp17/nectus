import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Activity, Bot, GitBranch, Github, Info, KanbanSquare, Palette, Plus, Save, Terminal } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "../lib/utils";
import type { AgentProfile, AppSettings, AppSettingsInput, GithubStatus, JiraRestStatus } from "../types";
import { ProfileEditor } from "./settings/ProfileEditor";
import { GithubConnectionCard } from "./settings/GithubConnectionCard";
import { JiraConnectionCard } from "./settings/JiraConnectionCard";
import { SegmentedRadioGroup } from "./settings/SegmentedRadioGroup";
import { Switch } from "./ui/switch";
import { SettingsOverviewItem } from "./settings/SettingsOverviewItem";
import { UpdateCard } from "./settings/UpdateCard";
import { DiagnosticsCard } from "./settings/DiagnosticsCard";
import { ChatPermissionPoliciesCard } from "./settings/ChatPermissionPoliciesCard";
import type { AppUpdateState } from "../hooks/useAppUpdate";
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
  jiraRestStatus?: JiraRestStatus;
  appUpdate: AppUpdateState;
  busy: boolean;
  onBack: () => void;
  onSaveSettings: (settings: AppSettingsInput) => Promise<unknown>;
  onSaveAgentProfile: (
    profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">,
  ) => Promise<AgentProfile>;
  onSaveJiraToken: (site: string, email: string, token: string) => Promise<JiraRestStatus>;
  onDisconnectJira: () => Promise<void>;
}

type SettingsSectionId = "profiles" | "projects" | "github" | "jira" | "appearance" | "diagnostics" | "about";

/** One settings section: a flat card with an icon-led header and an optional action cluster. */
function SettingsSection({
  id,
  icon,
  title,
  actions,
  children,
}: {
  id: SettingsSectionId;
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={`settings-section-${id}`} size="sm" className="shrink-0 gap-0 py-0 shadow-none">
      <CardHeader className="flex flex-row items-center gap-2.5 border-b px-4 py-3.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-primary">
        {icon}
        <CardTitle className="text-sm font-bold tracking-[-0.01em]">{title}</CardTitle>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5 px-4 py-4">{children}</CardContent>
    </Card>
  );
}

export function SettingsPage({
  settings,
  agentProfiles,
  githubStatus,
  jiraRestStatus,
  appUpdate,
  busy,
  onSaveSettings,
  onSaveAgentProfile,
  onSaveJiraToken,
  onDisconnectJira,
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
    { id: "jira", icon: <KanbanSquare />, label: "JIRA" },
    { id: "appearance", icon: <Palette />, label: "Appearance" },
    { id: "diagnostics", icon: <Activity />, label: "Diagnostics" },
    { id: "about", icon: <Info />, label: "About" },
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

  const addProfileButton = (
    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addProfileDraft}>
      <Plus data-icon="inline-start" />
      Add Profile
    </Button>
  );

  return (
    <section className="grid h-full min-h-0 grid-cols-[212px_minmax(0,1fr)] max-[1080px]:grid-cols-[minmax(0,1fr)]">
      <nav className="flex flex-col gap-0.5 overflow-y-auto border-r bg-sidebar/60 px-3 py-5 max-[1080px]:flex-row max-[1080px]:flex-wrap max-[1080px]:gap-1 max-[1080px]:border-r-0 max-[1080px]:border-b max-[1080px]:p-3">
        <div className="px-2.5 pb-3.5 max-[1080px]:w-full max-[1080px]:px-2 max-[1080px]:pb-2">
          <h1 className="m-0 text-[21px] font-bold tracking-[-0.02em]">Settings</h1>
          <p className="m-0 mt-0.5 text-[11.5px] text-muted-foreground">Local · ~/.nectus</p>
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground max-[1080px]:w-auto max-[1080px]:flex-1 [&>svg]:size-[15px] [&>svg]:shrink-0",
              activeSection === item.id && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
            )}
            data-active={activeSection === item.id}
            onClick={() => goToSection(item.id)}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="ml-auto font-mono text-[11px]">{item.count}</span>}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-7 pt-6 pb-22 [scroll-padding-bottom:88px]">
          <div
            className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4 max-[1080px]:grid-cols-1"
            aria-label="Settings summary"
          >
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
            <SettingsOverviewItem
              icon={<Info />}
              label="Version"
              value={appUpdate.currentVersion ? `v${appUpdate.currentVersion}` : "—"}
            />
          </div>

          <SettingsSection
            id="profiles"
            icon={<Bot />}
            title="Agent Profiles"
            actions={
              <>
                <Badge variant="outline" aria-label={profileCountLabel}>
                  {profileCountLabel}
                </Badge>
                {addProfileButton}
              </>
            }
          >
            <Item variant="muted">
              <ItemMedia variant="icon" className="size-8 rounded-md bg-card shadow-xs">
                {selectedDefaultProfile ? <AgentLogo agentKind={selectedDefaultProfile.agentKind} size="sm" /> : <Terminal />}
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="text-[13px]">Default agent</ItemTitle>
                <ItemDescription>Used when a new task does not choose a specific profile.</ItemDescription>
              </ItemContent>
              <ItemActions>
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
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value={noDefaultProfileValue}>No default</SelectItem>
                      {defaultProfileOptions.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id!.toString()} textValue={profile.name}>
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <AgentLogo agentKind={profile.agentKind} size="sm" />
                            {profile.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </ItemActions>
            </Item>

            <div className="flex flex-col gap-3">
              {profileDrafts.length === 0 ? (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Terminal />
                    </EmptyMedia>
                    <EmptyTitle>No agent profiles yet</EmptyTitle>
                    <EmptyDescription>Add a profile to choose which CLI agent runs your tasks.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>{addProfileButton}</EmptyContent>
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
          </SettingsSection>

          <SettingsSection id="projects" icon={<GitBranch />} title="Projects & Worktrees">
            <FieldGroup className="grid gap-4 lg:grid-cols-2">
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
                  placeholder="~/.nectus/worktrees/{repoName}"
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
              <Field orientation="horizontal" className="lg:col-span-2">
                <FieldContent>
                  <FieldLabel htmlFor="persistent-sessions">Persistent sessions</FieldLabel>
                  <FieldDescription>
                    Run agents inside a dedicated tmux server so they keep working while the app
                    is closed and reattach on the next launch. Requires tmux 3.2+ on this Mac.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="persistent-sessions"
                  checked={settingsDraft.persistentSessions}
                  onCheckedChange={(checked) =>
                    setSettingsDraft((current) => ({ ...current, persistentSessions: checked }))
                  }
                />
              </Field>
            </FieldGroup>
          </SettingsSection>

          <SettingsSection id="github" icon={<Github />} title="GitHub">
            <GithubConnectionCard status={githubStatus} />
          </SettingsSection>

          <SettingsSection id="jira" icon={<KanbanSquare />} title="JIRA">
            <JiraConnectionCard
              status={jiraRestStatus}
              busy={busy}
              onSave={onSaveJiraToken}
              onDisconnect={onDisconnectJira}
            />
          </SettingsSection>

          <SettingsSection id="appearance" icon={<Palette />} title="Appearance">
            <FieldGroup className="grid gap-4 lg:grid-cols-2">
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
          </SettingsSection>

          <SettingsSection id="diagnostics" icon={<Activity />} title="Diagnostics">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chat permission policies
                </h3>
                <ChatPermissionPoliciesCard />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Backend log
                </h3>
                <p className="m-0 text-[12.5px] leading-normal text-muted-foreground">
                  Live backend log (the same output Rust prints to the console). Streams while the app runs,
                  so you can see exactly where a hang occurs. Use Copy to share it when reporting an issue.
                </p>
                <DiagnosticsCard />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection id="about" icon={<Info />} title="About & Updates">
            <UpdateCard
              status={appUpdate.status}
              info={appUpdate.info}
              currentVersion={appUpdate.currentVersion}
              progress={appUpdate.progress}
              error={appUpdate.error}
              lastCheckedAt={appUpdate.lastCheckedAt}
              onCheck={() => appUpdate.check()}
              onInstall={appUpdate.installUpdate}
              onRelaunch={appUpdate.relaunch}
            />
          </SettingsSection>
        </div>

        <div className="flex shrink-0 justify-end border-t bg-card/55 px-7 py-3.5">
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
