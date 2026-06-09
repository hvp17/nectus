import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "./queryClient";
import { queryKeys } from "./keys";
import { useJiraProjectStatusesQuery } from "./jira";

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

vi.mock("../api", () => ({
  api: {
    jiraProjectStatuses: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.jiraProjectStatuses).mockResolvedValue([]);
});

describe("useJiraProjectStatusesQuery", () => {
  it("does not allocate a project-statuses query without a project", () => {
    const client = createQueryClient();

    renderHook(() => useJiraProjectStatusesQuery(null, true), { wrapper: makeWrapper(client) });

    expect(client.getQueryCache().find({ queryKey: queryKeys.jira.projectStatuses("") })).toBeUndefined();
    expect(client.getQueryCache().find({ queryKey: queryKeys.jira.projectStatuses(null) })).toBeUndefined();
    expect(api.jiraProjectStatuses).not.toHaveBeenCalled();
  });
});
