import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauriRuntime";

interface UseTauriEventOptions {
  /** Skip subscribing while false (e.g. a panel that isn't open yet). */
  enabled?: boolean;
  /** Surface a subscription failure; receives the rejection from `listen`. */
  onError?: (error: unknown) => void;
}

/**
 * Subscribe to a Tauri event for the lifetime of the component, handling the
 * disposed/unlisten race once: a listener that resolves after unmount is
 * immediately torn down, and the handler never fires after cleanup.
 *
 * `handler` and `onError` are held in refs so the subscription only re-runs when
 * `eventName`/`enabled` change — a parent re-render with fresh callbacks won't
 * resubscribe. Outside the Tauri runtime it's a no-op. Replaces the hand-rolled
 * `let disposed; listen(...).then(...).catch(...)` idiom duplicated across hooks.
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
  options?: UseTauriEventOptions,
) {
  const enabled = options?.enabled ?? true;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<T>(eventName, (event) => {
      if (!disposed) handlerRef.current(event.payload);
    })
      .then((callback) => {
        if (disposed) callback();
        else unlisten = callback;
      })
      .catch((error) => {
        if (!disposed) onErrorRef.current?.(error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName, enabled]);
}
