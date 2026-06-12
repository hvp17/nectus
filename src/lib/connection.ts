/**
 * Whether a CLI integration (GitHub `gh`) is ready to use: both installed and
 * authenticated. Keeps the `installed && authenticated` derivation in one place.
 */
export function isCliConnected(
  status: { installed: boolean; authenticated: boolean } | null | undefined,
): boolean {
  return Boolean(status?.installed && status?.authenticated);
}
