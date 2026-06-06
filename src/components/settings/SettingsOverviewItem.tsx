import { type ReactNode } from "react";

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
    <div className="nx-ov">
      <span className="nx-ov-ic">{icon}</span>
      <span>
        <small>{label}</small>
        <strong className={mono ? "mono" : undefined}>{value}</strong>
      </span>
    </div>
  );
}
