import { useQueries, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";

type OptionalQueryOptions<TData, TQueryKey extends QueryKey> = UseQueryOptions<TData, Error, TData, TQueryKey>;

interface OptionalQueryResult<TData> {
  data: TData | undefined;
  error: Error | null;
  isLoading: boolean;
}

export function useOptionalQuery<TData, TQueryKey extends QueryKey = QueryKey>(
  options: OptionalQueryOptions<TData, TQueryKey> | null | undefined,
): OptionalQueryResult<TData> {
  const queryOptions: Array<OptionalQueryOptions<TData, TQueryKey>> = options ? [options] : [];
  const queries = useQueries({ queries: queryOptions });
  const query = queries[0];

  return {
    data: query?.data as TData | undefined,
    error: query?.error ?? null,
    isLoading: Boolean(query?.isLoading),
  };
}
