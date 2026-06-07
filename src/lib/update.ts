import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  contentLength: number | null;
}

export interface UpdateCheckResult {
  info: UpdateInfo;
  update: Update;
}

/** The updater only works inside the Tauri runtime; everywhere else (browser
 * preview, Vitest) every call below no-ops so the UI degrades cleanly. */
export function isUpdaterAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppVersion(): Promise<string | null> {
  if (!isUpdaterAvailable()) return null;
  return getVersion();
}

export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  if (!isUpdaterAvailable()) return null;
  const update = await check();
  if (!update) return null;
  return {
    update,
    info: {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
      date: update.date ?? null,
    },
  };
}

export async function installUpdate(
  update: Update,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let contentLength: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        onProgress?.({ downloaded, contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, contentLength });
        break;
      case "Finished":
        onProgress?.({ downloaded, contentLength });
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  if (!isUpdaterAvailable()) return;
  await relaunch();
}
