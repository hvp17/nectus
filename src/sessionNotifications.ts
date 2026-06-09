import { api } from "./api";
import { isTauriRuntime } from "./lib/tauriRuntime";
import { formatNotificationBody } from "./notificationText";

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
