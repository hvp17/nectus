import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UpdateStatus } from "./useAppUpdate";
import type { UpdateInfo } from "../lib/update";

interface UseAppUpdateToastParams {
  status: UpdateStatus;
  info: UpdateInfo | null;
  onInstall: () => void;
  onRelaunch: () => void;
}

// Surfaces auto-update transitions as non-blocking sonner toasts: one when a
// newer version is available (Install action) and one when the download has
// installed and only a relaunch remains (Relaunch action). Each fires once per
// version so re-renders never duplicate it.
export function useAppUpdateToast({ status, info, onInstall, onRelaunch }: UseAppUpdateToastParams) {
  const availableShownFor = useRef<string | null>(null);
  const readyShownFor = useRef<string | null>(null);

  useEffect(() => {
    if (status === "available" && info && availableShownFor.current !== info.version) {
      availableShownFor.current = info.version;
      toast("Update available", {
        description: `Version ${info.version} is ready to install.`,
        duration: 10000,
        action: { label: "Install", onClick: onInstall },
      });
    }
  }, [status, info, onInstall]);

  useEffect(() => {
    if (status === "ready" && info && readyShownFor.current !== info.version) {
      readyShownFor.current = info.version;
      toast.success("Update installed", {
        description: "Relaunch Nectus to finish updating.",
        duration: Infinity,
        action: { label: "Relaunch", onClick: onRelaunch },
      });
    }
  }, [status, info, onRelaunch]);
}
