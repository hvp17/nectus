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
