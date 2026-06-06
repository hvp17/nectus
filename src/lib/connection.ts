/**
 * Whether a CLI integration (GitHub `gh` / JIRA `acli`) is ready to use: both
 * installed and authenticated. `GithubStatus` and `JiraStatus` share this shape,
 * so one helper covers both and the `installed && authenticated` derivation lives
 * in one place.
 */
export function isCliConnected(
  status: { installed: boolean; authenticated: boolean } | null | undefined,
): boolean {
  return Boolean(status?.installed && status?.authenticated);
}
