import { describe, expect, it, rs } from "@rstest/core";

import {
  clearThreadReadCache,
  THREAD_HISTORY_QUERY_POLICY,
} from "@/core/threads/hooks";

describe("thread history query policy", () => {
  it("does not refetch immutable pages on window focus", () => {
    expect(THREAD_HISTORY_QUERY_POLICY).toEqual({
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1_000,
    });
  });

  it("cancels and removes all cached data for a thread after read access is revoked", () => {
    const cancelQueries = rs.fn();
    const removeQueries = rs.fn();
    clearThreadReadCache(
      { cancelQueries, removeQueries } as never,
      "thread-1",
      "user-1",
    );

    const queryKeys = [
      ["thread", "thread-1"],
      ["thread", "metadata", "thread-1"],
      ["thread-messages", "thread-1"],
      ["thread-token-usage", "thread-1", "user-1"],
    ];
    expect(
      cancelQueries.mock.calls.map(([filters]) => filters.queryKey),
    ).toEqual(queryKeys);
    expect(
      removeQueries.mock.calls.map(([filters]) => filters.queryKey),
    ).toEqual(queryKeys);
  });
});
