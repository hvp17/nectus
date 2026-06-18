import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkSafetyModalProps } from "streamdown";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { openExternal } from "../../lib/openExternal";

const COPIED_RESET_MS = 2000;

/**
 * Confirmation modal for external links rendered inside agent chat output.
 *
 * Replaces streamdown's built-in link-safety modal, whose "Open link" action
 * calls `window.open(url, "_blank")` — a no-op inside the Tauri webview (see
 * `lib/openExternal.ts`). Here the open is routed through the app's opener
 * plugin instead, so chat links actually open in the system browser. Wired via
 * `linkSafety.renderModal` on `MessageResponse`.
 */
export function ChatLinkDialog({ url, isOpen, onClose }: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(copiedResetRef.current), []);

  const copyLink = useCallback(() => {
    if (!navigator?.clipboard?.writeText) return;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    window.clearTimeout(copiedResetRef.current);
    copiedResetRef.current = window.setTimeout(
      () => setCopied(false),
      COPIED_RESET_MS,
    );
  }, [url]);

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ExternalLinkIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Open external link?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;re about to visit an external website.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="overflow-hidden rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
          {url}
        </p>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            onClick={copyLink}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => openExternal(url)}>
            <ExternalLinkIcon />
            Open link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
