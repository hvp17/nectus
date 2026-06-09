import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  getAppVersion,
  installUpdate as runInstall,
  relaunchApp,
  type InstallableUpdate,
  type UpdateInfo,
} from "../lib/update";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  currentVersion: string | null;
  progress: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  check: () => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunch: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdate(): AppUpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const pending = useRef<InstallableUpdate | null>(null);
  const checkRequestId = useRef(0);
  // Synchronous re-entrancy guard: the toast Install action and the card Install
  // button both call installUpdate, and `disabled` only applies after a render —
  // a ref set before the first await blocks a concurrent second download/install
  // on the same Update resource (the plugin does not lock it).
  const installing = useRef(false);

  const check = useCallback(async () => {
    const requestId = ++checkRequestId.current;
    pending.current = null;
    setStatus("checking");
    setInfo(null);
    setProgress(null);
    setError(null);
    try {
      const result = await checkForUpdate();
      if (requestId !== checkRequestId.current) return;
      setLastCheckedAt(Date.now());
      if (!result) {
        setStatus("upToDate");
        return;
      }
      pending.current = result.update;
      setInfo(result.info);
      setStatus("available");
    } catch (caught) {
      if (requestId !== checkRequestId.current) return;
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!pending.current || installing.current) return;
    installing.current = true;
    setStatus("downloading");
    setProgress(0);
    setError(null);
    try {
      await runInstall(pending.current, ({ downloaded, contentLength }) => {
        setProgress(contentLength ? Math.min(1, downloaded / contentLength) : null);
      });
      setProgress(1);
      setStatus("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    } finally {
      installing.current = false;
    }
  }, []);

  const relaunch = useCallback(async () => {
    await relaunchApp();
  }, []);

  // One silent check shortly after launch. Outside Tauri the lib no-ops,
  // so this resolves to `upToDate` with no network and no UI noise.
  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((version) => {
      if (!cancelled) setCurrentVersion(version);
    });
    void check();
    return () => {
      cancelled = true;
    };
  }, [check]);

  return {
    status,
    info,
    currentVersion,
    progress,
    error,
    lastCheckedAt,
    check,
    installUpdate,
    relaunch,
  };
}
