import type { JiraWorkItem } from "../types";

/**
 * Re-read the selected work item from the freshly loaded board so the docked
 * view panel stays in lockstep after a transition/assign refresh. A selection
 * that is not on the board (e.g. a just-created item not yet in the results) is
 * preserved as-is, and a null selection passes through.
 */
export function syncSelectedWorkItem(
  current: JiraWorkItem | null,
  items: JiraWorkItem[],
): JiraWorkItem | null {
  if (!current) return current;
  return items.find((item) => item.key === current.key) ?? current;
}

/**
 * Canonical JIRA Cloud browse URL for an issue, e.g.
 * `https://acme.atlassian.net/browse/PROJ-1`.
 *
 * `acli` only exposes the REST `self` link (`…/rest/api/3/issue/<id>`), which is
 * an API endpoint, not a page a person can open. The human-facing URL is always
 * `https://<site>/browse/<KEY>`, so we build it from the connected site host plus
 * the issue key rather than trusting whatever URL the CLI returned.
 */
export function jiraBrowseUrl(
  site: string | null | undefined,
  key: string | null | undefined,
): string | null {
  if (!site || !key) return null;
  const host = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/browse/${key}`;
}
