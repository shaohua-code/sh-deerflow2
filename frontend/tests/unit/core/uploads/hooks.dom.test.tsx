import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "/backend" }));

import { useUploadedFiles, useUploadLimits } from "@/core/uploads/hooks";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

test("upload-limit reads pass React Query's signal and stop after permission revocation", async () => {
  const client = makeClient();
  let requestSignal: AbortSignal | undefined;
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (requestSignal?.aborted) {
          abort();
        } else {
          requestSignal?.addEventListener("abort", abort, { once: true });
        }
      }),
  );

  const view = renderHook(
    ({ enabled }) => useUploadLimits("thread-1", { enabled }),
    { initialProps: { enabled: true }, wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
    expect(view.result.current.data).toBeUndefined();

    view.rerender({ enabled: false });

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(client.getQueryData(["uploads", "limits", "thread-1"])).toBe(
        undefined,
      ),
    );
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.error).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("upload-limit cache is hidden and removed when threads:read is denied", async () => {
  const client = makeClient();
  client.setQueryData(["uploads", "limits", "thread-1"], {
    max_files: 10,
    max_file_size: 1024,
    max_total_size: 4096,
  });

  const view = renderHook(
    () => useUploadLimits("thread-1", { enabled: false }),
    {
      wrapper: wrapperFor(client),
    },
  );
  try {
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(["uploads", "limits", "thread-1"])).toBe(
        undefined,
      ),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("uploaded-file reads pass a signal and clear their cache without threads:read", async () => {
  const client = makeClient();
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ files: [], count: 0 })),
  );

  const view = renderHook(
    ({ enabled }) => useUploadedFiles("thread-1", { enabled }),
    { initialProps: { enabled: true }, wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      view.rerender({ enabled: false });
    });

    await waitFor(() =>
      expect(client.getQueryData(["uploads", "list", "thread-1"])).toBe(
        undefined,
      ),
    );
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.error).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    client.clear();
  }
});
