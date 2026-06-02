import { toast } from "sonner";
import { api } from "../api";

/**
 * Opens a URL in the system's default browser.
 *
 * A plain `<a target="_blank">` does nothing inside the Tauri webview, so links
 * must be routed through the opener plugin. Surfaces a toast if opening fails.
 */
export function openExternal(url: string): void {
  api.openExternalUrl(url).catch((error) => {
    console.error("Failed to open external URL", url, error);
    toast.error("Couldn't open link", {
      description: "Opening the link in your browser failed.",
    });
  });
}
