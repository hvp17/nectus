import { Check, Cpu, Star, Terminal } from "lucide-react";
import { AgentLogo, ModelLogo } from "../AgentBrand";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { AgentKind } from "../../types";
import {
  agentKindLabels,
  cliDefaultModelValue,
  customModelValue,
  modelPresets,
  type ProfileDraft,
} from "./profileDrafts";

interface ProfileEditorProps {
  profile: ProfileDraft;
  isDefault: boolean;
  busy: boolean;
  onChange: (patch: Partial<ProfileDraft>) => void;
  onSave: () => void;
}

export function ProfileEditor({ profile, isDefault, busy, onChange, onSave }: ProfileEditorProps) {
  const presets = modelPresets[profile.agentKind];
  const modelValue =
    profile.model && presets.includes(profile.model) ? profile.model : profile.model ? customModelValue : cliDefaultModelValue;
  const selectedModel = modelValue === customModelValue ? profile.customModel : modelValue === cliDefaultModelValue ? null : modelValue;
  const commandLabel = profile.command.trim() || "No command set";
  const modelLabel = selectedModel || "CLI default";
  const saveDisabled = busy || !profile.name.trim() || !profile.command.trim();

  return (
    <Card size="sm" className="gap-0 py-0 shadow-none" data-agent-kind={profile.agentKind}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentLogo
            agentKind={profile.agentKind}
            size="md"
            className="size-9 rounded-md bg-muted p-[7px] text-muted-foreground"
          />
          <div className="grid min-w-0 gap-1.5">
            <Input
              aria-label="Profile name"
              value={profile.name}
              onChange={(event) => onChange({ name: event.target.value })}
              className="h-[30px] max-w-[360px] border-transparent bg-transparent px-0 text-[15px] font-bold tracking-[-0.01em] shadow-none focus-visible:border-ring focus-visible:bg-background focus-visible:px-2.5"
            />
            <p className="m-0 flex min-w-0 flex-wrap items-center gap-[7px] text-xs text-muted-foreground">
              <Terminal size={13} />
              <span className={profile.command.trim() ? "font-mono" : undefined}>{commandLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{modelLabel}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <div className="flex flex-wrap justify-end gap-1.5">
            {isDefault && (
              <Badge variant="outline" className="gap-1.5">
                <Star size={11} />
                Default
              </Badge>
            )}
            <Badge variant="outline" className="gap-1.5">
              <AgentLogo agentKind={profile.agentKind} size="sm" />
              {agentKindLabels[profile.agentKind]}
            </Badge>
          </div>
          <Select value={profile.agentKind} onValueChange={(value) => onChange({ agentKind: value as AgentKind })}>
            <SelectTrigger aria-label="Agent kind" className="h-8 w-[150px] justify-between">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {Object.entries(agentKindLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value} textValue={label}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <AgentLogo agentKind={value as AgentKind} size="sm" />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="gap-2" onClick={onSave} disabled={saveDisabled}>
            <Check data-icon="inline-start" />
            Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 py-4">
        <FieldGroup className="grid gap-3.5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`profile-command-${profile.id ?? "new"}`}>
              <Terminal size={13} />
              Command
            </FieldLabel>
            <Input
              id={`profile-command-${profile.id ?? "new"}`}
              value={profile.command}
              onChange={(event) => onChange({ command: event.target.value })}
              placeholder="e.g. codex"
              className="font-mono"
            />
          </Field>
          <Field>
            <FieldLabel>
              <Cpu size={13} />
              Model
            </FieldLabel>
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
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectItem value={cliDefaultModelValue} textValue="CLI default">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <ModelLogo agentKind={profile.agentKind} model={null} size="sm" />
                      CLI default
                    </span>
                  </SelectItem>
                  {presets.map((preset) => (
                    <SelectItem key={preset} value={preset} textValue={preset}>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ModelLogo agentKind={profile.agentKind} model={preset} size="sm" />
                        {preset}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={customModelValue} textValue="Custom...">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <ModelLogo agentKind="custom" model={profile.customModel || "custom"} size="sm" />
                      Custom...
                    </span>
                  </SelectItem>
                </SelectGroup>
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
          </Field>
          <Field>
            <FieldLabel htmlFor={`profile-args-${profile.id ?? "new"}`}>
              <Terminal size={13} />
              Args
            </FieldLabel>
            <Textarea
              id={`profile-args-${profile.id ?? "new"}`}
              value={profile.argsText}
              onChange={(event) => onChange({ argsText: event.target.value })}
              placeholder="One CLI argument per line"
              className="min-h-[76px] resize-y font-mono"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`profile-env-${profile.id ?? "new"}`}>
              <Cpu size={13} />
              Environment
            </FieldLabel>
            <Textarea
              id={`profile-env-${profile.id ?? "new"}`}
              value={profile.envText}
              onChange={(event) => onChange({ envText: event.target.value })}
              placeholder="KEY=value"
              className="min-h-[76px] resize-y font-mono"
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
