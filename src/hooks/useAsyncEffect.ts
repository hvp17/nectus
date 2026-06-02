import { useEffect, type DependencyList } from "react";

/**
 * useEffect for a fire-and-forget async task that must not touch state after the
 * effect is cleaned up. The task receives an `alive()` guard that flips to false
 * on unmount or dependency change; check it before every setState. Replaces the
 * hand-rolled `let disposed = false; …; return () => { disposed = true; }` idiom.
 */
export function useAsyncEffect(
  task: (alive: () => boolean) => void | Promise<void>,
  deps: DependencyList,
): void {
  useEffect(() => {
    let disposed = false;
    void task(() => !disposed);
    return () => {
      disposed = true;
    };
  }, deps);
}
