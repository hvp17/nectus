import { api } from "./api";
import { isTauriRuntime } from "./lib/tauriRuntime";

export async function notifySessionEvent(title: string, body: string) {
  if (!isTauriRuntime()) return;

  try {
    const sent = await api.sendSystemNotification(title, body);
    if (!sent) {
      console.warn("Notification permission not granted");
    }
  } catch (error) {
    console.error("Failed to send session notification", error);
  }
}
