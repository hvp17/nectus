import type { ReactElement, ReactNode } from "react";
import { fireEvent, render, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { expect, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import type { AgentProfile, AppSettings, Repo, TaskSummary, Workspace } from "../types";

/** Reset the singleton UI store to its initial state between tests (run in setup). */
export function resetAppStore() {
  useAppStore.setState(useAppStore.getInitialState(), true);
}

export const testTimestamp = "2026-06-09T00:00:00.000Z";

export function appSettingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    defaultAgentProfileId: null,
    defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
    defaultBranchPrefix: "tgadliauskas/",
    jiraBoardJql: null,
    jiraSiteUrl: null,
    jiraBoardProject: null,
    jiraFilterMyIssues: false,
    jiraFilterUnresolved: true,
    jiraFilterCurrentSprint: false,
    jiraRestEmail: null,
    jiraFilterStatuses: [],
    persistentSessions: false,
    theme: "system",
    density: "comfortable",
    updatedAt: testTimestamp,
    ...overrides,
  };
}

export function seedBootstrapQueries(
  queryClient: QueryClient,
  {
    repos = [],
    workspaces = [],
    agentProfiles = [],
    settings = appSettingsFixture(),
    tasks = [],
  }: {
    repos?: Repo[];
    workspaces?: Workspace[];
    agentProfiles?: AgentProfile[];
    settings?: AppSettings;
    tasks?: TaskSummary[];
  } = {},
) {
  queryClient.setQueryData(queryKeys.repos(), repos);
  queryClient.setQueryData(queryKeys.workspaces(), workspaces);
  queryClient.setQueryData(queryKeys.agentProfiles(), agentProfiles);
  queryClient.setQueryData(queryKeys.settings(), settings);
  queryClient.setQueryData(queryKeys.tasks(), tasks);
}

export function expectQueryInvalidated(queryClient: QueryClient, queryKey: QueryKey) {
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
}

export function expectBootstrapInvalidated(queryClient: QueryClient) {
  expectQueryInvalidated(queryClient, queryKeys.repos());
  expectQueryInvalidated(queryClient, queryKeys.workspaces());
  expectQueryInvalidated(queryClient, queryKeys.agentProfiles());
  expectQueryInvalidated(queryClient, queryKeys.settings());
  expectQueryInvalidated(queryClient, queryKeys.tasks());
}

export type TestPointerEvent = Event & {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
};

/**
 * Render under the app's full provider stack (TanStack Query + Tooltip). A fresh
 * `QueryClient` per call keeps each test's cache isolated. Use this for anything
 * that reads through the query layer; pass a seeded client to preload the cache.
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient = createQueryClient(), ...options }: RenderOptions & { queryClient?: QueryClient } = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}

/**
 * Back-compat alias kept for the many component tests that predate the query
 * layer. Now provider-complete (Query + Tooltip) so a leaf component that starts
 * consuming a query hook keeps passing without a test edit.
 */
export function renderWithTooltipProvider(ui: ReactElement, options?: RenderOptions) {
  return renderWithProviders(ui, options);
}

export function mockElementsFromPoint(elements: Element[]) {
  const originalElementsFromPoint = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => elements,
  });
  return () => {
    if (originalElementsFromPoint) {
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: originalElementsFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, "elementsFromPoint");
    }
  };
}

export function dispatchPointerEvent(
  target: Element | Node | Window | Document,
  type: string,
  init: { pointerId: number; button?: number; clientX: number; clientY: number },
): TestPointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TestPointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  fireEvent(target, event);
  return event;
}

export function pointerDrag(taskCard: HTMLElement, target: Element) {
  const restoreElementsFromPoint = mockElementsFromPoint([target]);
  dispatchPointerEvent(taskCard, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientX: 40, clientY: 10 });
  dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 40, clientY: 10 });
  restoreElementsFromPoint();
}

export function mockElementRect(element: Element, rect: Partial<DOMRect>) {
  const fullRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    width: rect.width ?? 100,
    height: rect.height ?? 100,
    top: rect.top ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 100),
    left: rect.left ?? 0,
    toJSON: () => ({}),
  } as DOMRect;
  const spy = vi.spyOn(element, "getBoundingClientRect").mockReturnValue(fullRect);
  return () => spy.mockRestore();
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
