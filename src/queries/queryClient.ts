import { QueryCache, QueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";

/**
 * Factory for the app's QueryClient. A factory (not a module singleton) so each
 * `<App/>` mount — including every `render(<App/>)` in the test suite — gets an
 * isolated cache and tests can't leak fetched state into one another.
 *
 * Defaults chosen for a local-first Tauri app whose "server" is in-process Rust
 * commands, not a network API:
 * - `retry: false` — a failed `invoke` is deterministic; retrying just delays the
 *   error (and would hang tests that assert on a rejected command).
 * - `refetchOnWindowFocus: false` globally — the previous hooks only refetched the
 *   *open PR* on focus, so that single behavior is opted back in on its own query
 *   rather than applied app-wide.
 * - a small `staleTime` so the event bridge's `setQueryData` writes aren't
 *   immediately clobbered by a refetch; long-lived data (repos, settings) raises it
 *   per-query.
 *
 * The `QueryCache` error handler surfaces any failed read through the store's
 * message channel — preserving the old `refresh()` behavior where a failed
 * `api.listRepos()`/`listTasks()`/… set a user-visible message instead of silently
 * rendering an empty app.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      // Only surface errors from queries that opt in (the bootstrap reads, via
      // `meta.surfaceErrors`). Best-effort reads — PR status polling, JIRA board,
      // diffs — stay silent, matching the pre-migration behavior.
      onError: (error, query) => {
        if (query.meta?.surfaceErrors) useAppStore.getState().setMessage(String(error));
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
