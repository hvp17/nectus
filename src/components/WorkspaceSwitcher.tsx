import { Settings2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import type { Workspace } from "../types";

const ALL = "all";

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  activeWorkspaceId?: number;
  onSelect: (id: number | undefined) => void;
  onManage: () => void;
}

/**
 * Compact single-select for the active-workspace repo-scope filter. "All repos"
 * clears the filter; "Manage" opens the workspace manager. Reused on Mission
 * Control and the board's project rail, both driving the same global selection.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onManage,
}: WorkspaceSwitcherProps) {
  return (
    <div className="nx-ws-switcher" role="group" aria-label="Workspace filter">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={activeWorkspaceId ? String(activeWorkspaceId) : ALL}
        onValueChange={(value) => {
          // Radix emits "" when the active item is toggled off; treat that as
          // "keep current" rather than clearing to an invalid empty selection.
          if (!value) return;
          onSelect(value === ALL ? undefined : Number(value));
        }}
      >
        <ToggleGroupItem value={ALL} aria-label="All repos">
          All repos
        </ToggleGroupItem>
        {workspaces.map((workspace) => (
          <ToggleGroupItem key={workspace.id} value={String(workspace.id)} aria-label={workspace.name}>
            {workspace.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button variant="ghost" size="sm" onClick={onManage} aria-label="Manage workspaces">
        <Settings2 data-icon="inline-start" />
        Manage
      </Button>
    </div>
  );
}
