/**
 * Tool-call rows show paths the agent touched. The agent reports them absolute
 * (e.g. `/Users/.../worktrees/<repo>/<task>/src/types.ts`), which is long and
 * mostly the session's working directory repeated on every row. These helpers
 * strip the `cwd` prefix for display only — callers still pass the original
 * absolute path to the open-in-diff handler.
 */

/** Drop a trailing slash so `cwd` and `cwd/` compare the same. */
function normalizeBase(cwd: string): string {
  return cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
}

/**
 * Display `path` relative to `cwd`. Returns the basename when `path` *is* the
 * cwd, the sub-path when it's under the cwd, and the original path otherwise
 * (no cwd, blank path, or a path outside the worktree).
 */
export function relativizePath(path: string, cwd?: string | null): string {
  if (!cwd || !path) return path;
  const base = normalizeBase(cwd);
  if (path === base) return path.split("/").pop() ?? path;
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return path;
}

/**
 * Shorten absolute paths embedded in a shell command preview (e.g.
 * `find /Users/.../<task>/src/lib -type f`) by stripping the `cwd/` prefix from
 * each occurrence, leaving a readable relative arg (`find src/lib -type f`).
 * Only the `cwd/` form is stripped — a bare `cwd` token is left untouched so a
 * sibling worktree that merely shares the prefix is never mangled.
 */
export function relativizeCommand(command: string, cwd?: string | null): string {
  if (!cwd || !command) return command;
  const prefix = `${normalizeBase(cwd)}/`;
  return command.split(prefix).join("");
}
