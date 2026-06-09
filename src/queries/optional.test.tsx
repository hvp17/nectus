import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./queryClient";
import { useOptionalQuery } from "./optional";

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useOptionalQuery", () => {
  it("returns an idle result and creates no query when options are absent", () => {
    const client = createQueryClient();
    const { result } = renderHook(() => useOptionalQuery<string>(null), { wrapper: makeWrapper(client) });

    expect(result.current).toEqual({ data: undefined, error: null, isLoading: false });
    expect(client.getQueryCache().find({ queryKey: ["optional", "value"] })).toBeUndefined();
  });

  it("runs the query when options are provided", async () => {
    const client = createQueryClient();
    const queryFn = vi.fn().mockResolvedValue("ready");
    const { result } = renderHook(
      () =>
        useOptionalQuery<string>({
          queryKey: ["optional", "value"],
          queryFn,
        }),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toBe("ready"));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().find({ queryKey: ["optional", "value"] })).toBeDefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
