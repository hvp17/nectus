import type { JiraWorkItem } from "../types";

/** A group of issues sharing one epic (or the "no epic" bucket when `epicKey` is null). */
export interface EpicGroup {
  epicKey: string | null;
  epicName: string | null;
  items: JiraWorkItem[];
}

/**
 * Group a sprint lane's issues into epic swimlanes, preserving the first-seen epic
 * order so the layout is stable across refreshes. Issues with no epic collect into a
 * single trailing "No epic" group. Pure, so it is unit-tested in isolation.
 */
export function groupByEpic(items: JiraWorkItem[]): EpicGroup[] {
  const groups: EpicGroup[] = [];
  const byKey = new Map<string, EpicGroup>();
  let noEpic: EpicGroup | null = null;

  for (const item of items) {
    const key = item.epicKey ?? null;
    if (key === null) {
      if (!noEpic) noEpic = { epicKey: null, epicName: null, items: [] };
      noEpic.items.push(item);
      continue;
    }
    let group = byKey.get(key);
    if (!group) {
      group = { epicKey: key, epicName: item.epicName ?? null, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    // Backfill a name if the first occurrence lacked one but a later issue has it.
    if (!group.epicName && item.epicName) group.epicName = item.epicName;
    group.items.push(item);
  }

  if (noEpic) groups.push(noEpic);
  return groups;
}
