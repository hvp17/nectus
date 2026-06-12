import { type ReactNode } from "react";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item";
import { cn } from "../../lib/utils";

export function SettingsOverviewItem({
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
    <Item variant="outline" className="bg-card">
      <ItemMedia
        variant="icon"
        className="size-8 self-center rounded-md bg-muted text-muted-foreground group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center"
      >
        {icon}
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemDescription className="text-[10px] font-semibold tracking-wider uppercase">{label}</ItemDescription>
        <ItemTitle className={cn(mono ? "font-mono text-xs" : "text-[13px]")}>{value}</ItemTitle>
      </ItemContent>
    </Item>
  );
}
