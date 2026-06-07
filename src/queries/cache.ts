import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

/**
 * Build a React-style `setState` function backed by the TanStack Query cache.
 *
 * This is the bridge that let the `useApp` migration stay incremental: every
 * existing `setTasks(updater)` / `setRepos(value)` call site keeps working
 * verbatim while the underlying source of truth moves to the query cache. Wrap the
 * result in `useMemo(() => makeCacheSetter(...), [queryClient])` so its identity is
 * stable (event hooks hold it in effect deps and must not re-subscribe per render).
 *
 * A functional updater is applied only when the cache already holds a value. If an
 * event-driven `setTasks(prev => prev.map(...))` fires before the first fetch
 * resolves, applying it onto an empty fallback would write that fallback into the
 * cache and the in-flight fetch would then overwrite it — silently dropping the
 * update. Skipping instead lets the fetch land the authoritative data (the backend
 * is the source of truth), matching the pre-migration behavior.
 */
export function makeCacheSetter<T>(
  queryClient: QueryClient,
  key: QueryKey,
): Dispatch<SetStateAction<T>> {
  return (value) => {
    if (typeof value !== "function") {
      queryClient.setQueryData<T>(key, value);
      return;
    }
    const current = queryClient.getQueryData<T>(key);
    if (current === undefined) return; // no cached value yet — let the fetch populate it
    queryClient.setQueryData<T>(key, (value as (prev: T) => T)(current));
  };
}
