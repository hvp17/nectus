import { api } from "./api";

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function notifySessionEvent(title: string, body: string) {
  if (!isTauri) return;

  try {
    const sent = await api.sendSystemNotification(title, body);
    if (!sent) {
      console.warn("Notification permission not granted");
    }
  } catch (error) {
    console.error("Failed to send session notification", error);
  }
}
