import type { TaskAttention } from "../sessionAttention";

/**
 * True only in the in-browser preview (`pnpm dev` outside Tauri, outside the
 * test runner). Lives apart from `browserSeed.ts` so the bulky seed fixtures
 * can be a lazy-loaded chunk — the desktop bundle ships this gate, not the
 * fixture data.
 */
export const isBrowserPreview =
  typeof window !== "undefined" &&
  !("__TAURI_INTERNALS__" in window) &&
  import.meta.env.MODE !== "test";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// The two store-creation seeds stay sync (the Zustand store initializes
// synchronously); everything bigger lives in browserSeed behind a dynamic import.
export const seedLiveLines: Record<number, string> = {
  3: "Writing the file-sink adapter in src/sinks/file.ts",
  4: "Running pnpm test — 12 passed, 1 pending",
  5: "Auditing --muted-foreground contrast on dark surfaces",
  7: "Reviewing the diff against feat/json-status",
};

export const seedAttention: TaskAttention[] = [
  {
    taskId: 1, kind: "needs_input", title: "Fix OAuth redirect loop on sign-in", agentName: "Claude Sonnet",
    reason: "awaiting_decision", prompt: "Fix verified — 6 tests pass. Open a pull request?", updatedAt: ago(4),
  },
  {
    taskId: 2, kind: "needs_input", title: "Add JIRA board status filters", agentName: "Codex",
    reason: "awaiting_decision", prompt: "Should resolved issues be hidden by default in the board view?", updatedAt: ago(1),
  },
];
