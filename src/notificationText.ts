export const NOTIFICATION_BODY_LIMIT = 180;

export function formatNotificationBody(body: string) {
  const normalized = body.trim().replace(/\s+/g, " ");
  if (normalized.length <= NOTIFICATION_BODY_LIMIT) return normalized;

  return `${normalized.slice(0, NOTIFICATION_BODY_LIMIT - 3).trimEnd()}...`;
}
