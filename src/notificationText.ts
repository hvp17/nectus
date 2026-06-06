export const NOTIFICATION_BODY_LIMIT = 180;

// Agents end their turns with Markdown ("**PR created**", `branch`, [text](url),
// bullet lists). Notifications render as plain text, so strip the syntax to clean
// prose before truncating — otherwise the raw `**` and backticks leak into the toast.
function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code blocks: keep the inner code, drop the ``` fences and language tag.
      .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
      // Images ![alt](url) -> alt, then links [text](url) -> text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Bold/italic emphasis. Double markers first so **bold** doesn't leave a stray *.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/\*(.+?)\*/g, "$1")
      // Inline code `code` -> code.
      .replace(/`([^`]+)`/g, "$1")
      // Line-leading heading hashes, blockquotes, and list bullets.
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
      // Any leftover backticks or asterisks (underscores are left alone so
      // snake_case identifiers and branch names survive intact).
      .replace(/[`*]/g, "")
  );
}

export function formatNotificationBody(body: string) {
  const normalized = stripMarkdown(body).replace(/\s+/g, " ").trim();
  if (normalized.length <= NOTIFICATION_BODY_LIMIT) return normalized;

  const slice = normalized.slice(0, NOTIFICATION_BODY_LIMIT - 1);
  const lastSpace = slice.lastIndexOf(" ");
  // Cut on a word boundary when one sits reasonably close to the limit; fall back
  // to a hard cut for a single very long token (e.g. a bare URL).
  const cut = lastSpace > NOTIFICATION_BODY_LIMIT * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
