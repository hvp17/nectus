import { useCallback } from "react";

interface RunOptions {
  /** Toggle the busy flag for the duration of the action (requires a setBusy). */
  busy?: boolean;
  /** Re-throw after surfacing the error, for callers that need the rejection. */
  rethrow?: boolean;
}

export interface GuardedRun {
  <T>(action: () => Promise<T>, options: RunOptions & { rethrow: true }): Promise<T>;
  <T>(action: () => Promise<T>, options?: RunOptions): Promise<T | undefined>;
}

/**
 * Wraps an async action with the message/busy bookkeeping every command in the
 * app repeated by hand: clear the message, optionally flip busy, run, and on
 * failure surface `String(error)` via `setMessage`. The action keeps ownership
 * of its own success message and side effects.
 */
export function useGuardedAction(
  setMessage: (message: string | null) => void,
  setBusy?: (busy: boolean) => void,
): GuardedRun {
  return useCallback(
    async <T>(action: () => Promise<T>, options?: RunOptions): Promise<T | undefined> => {
      const busySetter = options?.busy ? setBusy : undefined;
      setMessage(null);
      busySetter?.(true);
      try {
        return await action();
      } catch (error) {
        setMessage(String(error));
        if (options?.rethrow) throw error;
        return undefined;
      } finally {
        busySetter?.(false);
      }
    },
    [setMessage, setBusy],
  );
}
