import { Check, Cpu, Star, Terminal } from "lucide-react";
import { AgentLogo, ModelLogo } from "../AgentBrand";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
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
