import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSettingsFixture } from "../test/testUtils";
import { useJira } from "./useJira";
import { useJiraBoardView } from "./useJiraBoardView";

vi.mock("./useJira", () => ({
  useJira: vi.fn(),
}));

const mockedUseJira = vi.mocked(useJira);

function jiraState(): ReturnType<typeof useJira> {
  return {
    jiraStatus: undefined,
    restStatus: undefined,
    restConnected: false,
    ready: true,
    projects: [],
    projectStatuses: [],
    items: [],
    columns: [],
    loading: false,
    refresh: vi.fn(),
    transition: vi.fn(),
    assign: vi.fn(),
    comment: vi.fn(),
    create: vi.fn(),
    setApiToken: vi.fn(),
    clearApiToken: vi.fn(),
  };
}

describe("useJiraBoardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps setBoardConfig stable when its dependencies are stable", () => {
    const jira = jiraState();
    mockedUseJira.mockReturnValue(jira);
    const settings = appSettingsFixture({ jiraBoardProject: "SCRUM" });
    const setSettings = vi.fn();
    const setMessage = vi.fn();

    const { result, rerender } = renderHook(
      () =>
        useJiraBoardView({
          active: true,
          settings,
          setSettings,
          setMessage,
        }),
    );
    const firstSetBoardConfig = result.current.setBoardConfig;

    rerender();

    expect(result.current.setBoardConfig).toBe(firstSetBoardConfig);
  });
});
