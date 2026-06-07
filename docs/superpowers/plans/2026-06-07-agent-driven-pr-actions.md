# Agent-Driven PR Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the four GitHub pull-request *write* actions (create / merge / mark-ready / close) through the task's running agent session as prompts, instead of deterministic `gh` calls — letting the agent author PR title/description and resolve conflicts/rebases.

**Architecture:** Frontend-only. A new pure prompts module builds each action's prompt; a new `useGithubShipActions` hook submits the prompt into `task.activeSessionId` via the existing `submit_session_input` command (declining with guidance when no session is running). `TaskWorkspaceOverlay` swaps its four `on*PullRequest` props from `useGithub` to the new hook. `useGithub` slims to read-only. `GitHubPanel` / `PullRequestActions` are presentational and unchanged. The deterministic `gh` write commands in Rust stay compiled/tested but dormant.

**Tech Stack:** React + TypeScript + Vite, TanStack Query, Zustand, Vitest.

---

### Task 1: PR action prompt builders

**Files:**
- Create: `src/lib/githubAgentPrompts.ts`
- Test: `src/lib/githubAgentPrompts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/githubAgentPrompts.test.ts
import { describe, expect, it } from "vitest";
import { closePrPrompt, createPrPrompt, markReadyPrompt, mergePrPrompt } from "./githubAgentPrompts";

describe("githubAgentPrompts", () => {
  it("create prompt tells the agent to author title and description itself", () => {
    const prompt = createPrPrompt({ draft: false });
    expect(prompt).toMatch(/title and description yourself/i);
    expect(prompt).toMatch(/\bgh\b/);
    expect(prompt).not.toMatch(/as a draft/i);
  });

  it("create prompt opens a draft when requested", () => {
    expect(createPrPrompt({ draft: true })).toMatch(/as a draft/i);
  });

  it("merge prompt interpolates the method, resolves conflicts, keeps the branch", () => {
    const prompt = mergePrPrompt("rebase");
    expect(prompt).toMatch(/gh pr merge --rebase/);
    expect(prompt).toMatch(/resolve the conflicts/i);
    expect(prompt).toMatch(/do not delete the branch/i);
  });

  it("mark-ready prompt uses gh pr ready", () => {
    expect(markReadyPrompt()).toMatch(/gh pr ready/);
  });

  it("close prompt closes without merging and keeps the branch", () => {
    const prompt = closePrPrompt();
    expect(prompt).toMatch(/gh pr close/);
    expect(prompt).toMatch(/without merging/i);
    expect(prompt).toMatch(/do not delete the branch/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/githubAgentPrompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/githubAgentPrompts.ts
import type { MergeMethod } from "../types";

/**
 * Prompts the app submits into a task's running agent session to drive GitHub
 * pull-request actions. The agent runs `git`/`gh` itself in the task worktree, so
 * it can push, rebase, resolve conflicts, and report back. These strings are the
 * single iteration surface for shipping behavior — tune wording here, not in Rust.
 */

export function createPrPrompt({ draft }: { draft: boolean }): string {
  return [
    "Open a GitHub pull request for this task's branch using the `gh` CLI.",
    "- Commit any outstanding work with a Conventional Commit message and push the branch to its remote first.",
    "- Write the pull request title and description yourself from the actual changes on this branch — do not ask me for them.",
    `- Open it against the remote default branch${draft ? " as a draft" : ""}.`,
    "- If a pull request already exists for this branch, update it instead of failing.",
    "Report the pull request URL here when you're done.",
  ].join("\n");
}

export function mergePrPrompt(method: MergeMethod): string {
  return [
    `Merge this task's pull request using \`gh pr merge --${method}\`.`,
    "- If the branch is behind its base or has merge conflicts, rebase it onto the base branch, resolve the conflicts, push, then merge.",
    "- Do not delete the branch.",
    "Report the result here when you're done.",
  ].join("\n");
}

export function markReadyPrompt(): string {
  return [
    "Mark this task's pull request ready for review using `gh pr ready`.",
    "Report the result here when you're done.",
  ].join("\n");
}

export function closePrPrompt(): string {
  return [
    "Close this task's pull request without merging it, using `gh pr close`.",
    "Do not delete the branch.",
    "Report the result here when you're done.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/githubAgentPrompts.test.ts`
Expected: PASS (5 tests).

---

### Task 2: `useGithubShipActions` hook

**Files:**
- Create: `src/hooks/useGithubShipActions.ts`
- Test: `src/hooks/useGithubShipActions.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/useGithubShipActions.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createPrPrompt, mergePrPrompt } from "../lib/githubAgentPrompts";
import { useGithubShipActions } from "./useGithubShipActions";
import type { TaskSummary } from "../types";

vi.mock("../api", () => ({ api: { submitSessionInput: vi.fn() } }));
const mockedApi = vi.mocked(api, true);

const task: TaskSummary = {
  id: 42, repoId: 7, taskRepos: [], title: "Ship it", prompt: "do", status: "review",
  prUrl: null, agentProfileId: 1, agentName: "Codex", agentKind: "codex",
  hasWorktree: true, branchName: "feat/x", worktreePath: "/tmp/wt", isDirty: false,
  activeSessionId: "session-1", lastSessionId: "session-1", lastSessionAgent: "codex",
  lastSessionCwd: "/tmp/wt", lastSessionLabel: null,
  createdAt: "2026-06-07T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.submitSessionInput.mockResolvedValue(undefined);
});

describe("useGithubShipActions", () => {
  it("submits the create prompt into the running session", async () => {
    const setMessage = vi.fn();
    const setTaskAttention = vi.fn();
    const { result } = renderHook(() => useGithubShipActions({ setMessage, setTaskAttention }));

    await act(async () => {
      await result.current.createPullRequest(task, { draft: false });
    });

    expect(mockedApi.submitSessionInput).toHaveBeenCalledWith("session-1", createPrPrompt({ draft: false }));
    expect(setTaskAttention).toHaveBeenCalled();
  });

  it("submits the merge prompt with the chosen method", async () => {
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage: vi.fn(), setTaskAttention: vi.fn() }),
    );

    await act(async () => {
      await result.current.mergePullRequest(task, "rebase");
    });

    expect(mockedApi.submitSessionInput).toHaveBeenCalledWith("session-1", mergePrPrompt("rebase"));
  });

  it("declines with guidance when no session is running", async () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage, setTaskAttention: vi.fn() }),
    );

    await act(async () => {
      await result.current.closePullRequest({ ...task, activeSessionId: null });
    });

    expect(mockedApi.submitSessionInput).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringMatching(/start or resume the agent/i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/hooks/useGithubShipActions.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useGithubShipActions.ts
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../api";
import { clearTaskAttention, type TaskAttention } from "../sessionAttention";
import { closePrPrompt, createPrPrompt, markReadyPrompt, mergePrPrompt } from "../lib/githubAgentPrompts";
import type { MergeMethod, TaskSummary } from "../types";

const NO_SESSION_MESSAGE = "Start or resume the agent for this task to ship from here.";

interface UseGithubShipActionsInput {
  setMessage: (message: string | null) => void;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
}

/**
 * The four GitHub ship actions, reworked to drive the task's running agent
 * session instead of calling `gh` directly: each submits a prompt (built in
 * `githubAgentPrompts`) into `task.activeSessionId` via `submit_session_input`,
 * so the agent authors the PR body and handles pushes/conflicts/rebases itself.
 * With no running session the action declines with guidance. Shapes match the
 * `on*PullRequest` props `GitHubPanel`/`PullRequestActions` already expect.
 */
export function useGithubShipActions({ setMessage, setTaskAttention }: UseGithubShipActionsInput) {
  const [creatingPullRequest, setCreatingPullRequest] = useState(false);
  const [pullRequestBusy, setPullRequestBusy] = useState(false);

  const dispatch = useCallback(
    async (task: TaskSummary, prompt: string, working: string, setBusy: (busy: boolean) => void) => {
      if (!task.activeSessionId) {
        setMessage(NO_SESSION_MESSAGE);
        return;
      }
      const sessionId = task.activeSessionId;
      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      setBusy(true);
      try {
        await api.submitSessionInput(sessionId, prompt);
        setMessage(working);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setBusy(false);
      }
    },
    [setMessage, setTaskAttention],
  );

  const createPullRequest = useCallback(
    (task: TaskSummary, options?: { draft?: boolean }) =>
      dispatch(
        task,
        createPrPrompt({ draft: options?.draft ?? false }),
        `Asked the agent to open a pull request for ${task.title}`,
        setCreatingPullRequest,
      ),
    [dispatch],
  );

  const mergePullRequest = useCallback(
    (task: TaskSummary, method: MergeMethod) =>
      dispatch(task, mergePrPrompt(method), `Asked the agent to merge the pull request for ${task.title}`, setPullRequestBusy),
    [dispatch],
  );

  const setPullRequestReady = useCallback(
    (task: TaskSummary) =>
      dispatch(task, markReadyPrompt(), `Asked the agent to mark the pull request ready for ${task.title}`, setPullRequestBusy),
    [dispatch],
  );

  const closePullRequest = useCallback(
    (task: TaskSummary) =>
      dispatch(task, closePrPrompt(), `Asked the agent to close the pull request for ${task.title}`, setPullRequestBusy),
    [dispatch],
  );

  return { createPullRequest, mergePullRequest, setPullRequestReady, closePullRequest, creatingPullRequest, pullRequestBusy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/hooks/useGithubShipActions.test.tsx`
Expected: PASS (3 tests).

---

### Task 3: Rewire the overlay and slim `useGithub`

**Files:**
- Modify: `src/components/TaskWorkspaceOverlay.tsx`
- Modify: `src/hooks/useGithub.ts`

- [ ] **Step 1: Slim `useGithub` to read-only**

In `src/hooks/useGithub.ts` remove: `createPullRequest`, `mergePullRequest`, `setPullRequestReady`, `closePullRequest`, `runPullRequestAction`, the `creatingPullRequest`/`pullRequestBusy` `useState`s, and their entries in the returned object. Drop now-unused imports (`useState` if unused, `MergeMethod`, `PullRequestInfo` if unused). Keep: status, `ghReady`, the PR-status query (`pullRequest`, `pullRequestLoading`), the detect/backfill effect, and `refreshPullRequest`. Final return:

```ts
  return {
    githubStatus,
    ghReady,
    pullRequest,
    pullRequestLoading,
    refreshPullRequest,
  };
```

- [ ] **Step 2: Rewire the overlay**

In `src/components/TaskWorkspaceOverlay.tsx`:
- Remove the `CREATE_PULL_REQUEST_PROMPT` constant and the inline `createPullRequest` `useCallback`.
- Remove the now-unused `clearTaskAttention` import (keep `getTaskAttention`). Remove `api` import only if no longer used (it is still used by `startReview` → keep).
- Add the hook and wire props:

```tsx
import { useGithubShipActions } from "../hooks/useGithubShipActions";
// ...
  const github = useGithub({ selectedTask: task, setMessage, applyTask });
  const ship = useGithubShipActions({ setMessage, setTaskAttention });
```

Then in the returned `<TaskWorkspace .../>`, change these props:

```tsx
      creatingPullRequest={ship.creatingPullRequest}
      pullRequestBusy={ship.pullRequestBusy}
      onCreatePullRequest={ship.createPullRequest}
      onRefreshPullRequest={github.refreshPullRequest}
      onMergePullRequest={ship.mergePullRequest}
      onSetPullRequestReady={ship.setPullRequestReady}
      onClosePullRequest={ship.closePullRequest}
```

- [ ] **Step 3: Typecheck + run the affected suites**

Run: `pnpm test -- src/components/TaskWorkspaceOverlay.test.tsx src/components/GitHubPanel.test.tsx src/components/TaskWorkspace.test.tsx`
Expected: PASS. `GitHubPanel`/`PullRequestActions` are presentational and untouched, so their tests pass unchanged; the overlay review test is unaffected.

---

### Task 4: Documentation

**Files:**
- Modify: `docs/github-integration.md`
- Modify: `docs/features.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `docs/github-integration.md`** — rewrite the create/merge/ready/close section: the four write actions now submit a prompt into the task's running agent session (the agent runs `git`/`gh`, authors the PR title/description, resolves conflicts/rebases); reads (status/detect/checks) stay deterministic and refresh the panel; the action requires a running session, else it declines with guidance; the dormant Rust write commands are noted as unused.

- [ ] **Step 2: `docs/features.md`** — update the ship-actions ownership/behavior bullet: writes flow through the agent session; merge/close still confirm first; create lets the agent write the PR body.

- [ ] **Step 3: `CLAUDE.md`** — update the `src/hooks/useGithub.ts` bullet (now read-only: status + PR read/refresh/detect), add `src/hooks/useGithubShipActions.ts` and `src/lib/githubAgentPrompts.ts`, and note the four `github.rs` write commands are dormant (writes go through the session).

---

### Task 5: Full verification

- [ ] **Step 1: Frontend tests** — Run: `pnpm test` — Expected: PASS.
- [ ] **Step 2: Frontend build** — Run: `pnpm build` — Expected: success (no TS errors).
- [ ] **Step 3: Rust tests (regression only)** — Run: `cd native && cargo test` — Expected: PASS (no Rust changed).

---

## Self-Review

- **Spec coverage:** prompts module (Task 1) ↔ spec §1; ship hook + session precondition (Task 2) ↔ spec §2 + "Session precondition"; overlay rewire + slim `useGithub` (Task 3) ↔ spec §3; create-authors-own-body covered by Task 1 test; merge confirm dialog unchanged (presentational, noted Task 3); docs (Task 4) ↔ spec "Documentation"; no Rust changes ↔ spec "out of scope". Covered.
- **Placeholder scan:** none — every code step has full content.
- **Type consistency:** `createPrPrompt({ draft })`, `mergePrPrompt(method)`, `markReadyPrompt()`, `closePrPrompt()` and the hook's returned names (`createPullRequest`/`mergePullRequest`/`setPullRequestReady`/`closePullRequest`/`creatingPullRequest`/`pullRequestBusy`) are identical across Tasks 1–3 and match the existing `TaskWorkspace`/`GitHubPanel` prop names. `setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>` matches `sessionRuntimeSlice`.
