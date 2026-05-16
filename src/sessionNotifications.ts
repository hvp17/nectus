import { api } from "./api";
import { formatNotificationBody } from "./notificationText";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export const isTauri = isTauriRuntime();

export async function notifySessionEvent(title: string, body: string) {
  if (!isTauriRuntime()) return;

  try {
    const sent = await api.sendSystemNotification(title, formatNotificationBody(body));
    if (!sent) {
      console.warn("Notification permission not granted");
    }
  } catch (error) {
    console.error("Failed to send session notification", error);
  }
}
