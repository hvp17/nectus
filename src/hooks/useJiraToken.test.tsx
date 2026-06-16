import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import type { AppSettings, JiraRestStatus } from "../types";
import { useJiraToken } from "./useJiraToken";

vi.mock("../api", () => ({
  api: {
    setJiraApiToken: vi.fn(),
    clearJiraApiToken: vi.fn(),
    getAppSettings: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    defaultAgentProfileId: 1,
    defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
    defaultBranchPrefix: null,
    jiraBoardJql: null,
    jiraSiteUrl: null,
    jiraBoardProject: null,
    jiraFilterMyIssues: false,
    jiraFilterUnresolved: true,
    jiraFilterCurrentSprint: false,
    jiraRestEmail: null,
    jiraFilterStatuses: [],
    theme: "system",
    density: "comfortable",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useJiraToken(), { wrapper });
  return { ...hook, client };
}

describe("useJiraToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the verified REST status and refreshes settings after connecting", async () => {
    const status: JiraRestStatus = {
      connected: true,
      site: "acme.atlassian.net",
      email: "dev@acme.test",
      error: null,
    };
    const refreshedSettings = settings({
      jiraSiteUrl: "https://acme.atlassian.net",
      jiraRestEmail: "dev@acme.test",
    });
    mockedApi.setJiraApiToken.mockResolvedValue(status);
    mockedApi.getAppSettings.mockResolvedValue(refreshedSettings);
    const { result, client } = setup();

    let returned: JiraRestStatus | undefined;
    await act(async () => {
      returned = await result.current.setApiToken("acme.atlassian.net", "dev@acme.test", "token");
    });

    expect(returned).toEqual(status);
    expect(mockedApi.setJiraApiToken).toHaveBeenCalledWith(
      "acme.atlassian.net",
      "dev@acme.test",
      "token",
    );
    expect(client.getQueryData(queryKeys.jira.restStatus())).toEqual(status);
    expect(client.getQueryData(queryKeys.settings())).toEqual(refreshedSettings);
  });

  it("invalidates REST status and refreshes settings after disconnecting", async () => {
    const refreshedSettings = settings({ jiraSiteUrl: null, jiraRestEmail: null });
    mockedApi.clearJiraApiToken.mockResolvedValue(undefined);
    mockedApi.getAppSettings.mockResolvedValue(refreshedSettings);
    const { result, client } = setup();
    client.setQueryData<JiraRestStatus>(queryKeys.jira.restStatus(), {
      connected: true,
      site: "acme.atlassian.net",
      email: "dev@acme.test",
      error: null,
    });

    await act(async () => {
      await result.current.clearApiToken();
    });

    expect(mockedApi.clearJiraApiToken).toHaveBeenCalled();
    expect(client.getQueryState(queryKeys.jira.restStatus())?.isInvalidated).toBe(true);
    expect(client.getQueryData(queryKeys.settings())).toEqual(refreshedSettings);
  });
});
