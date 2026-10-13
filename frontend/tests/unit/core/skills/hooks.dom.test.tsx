import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ loadSkills: rs.fn() }));

rs.mock("@/core/skills", () => ({ loadSkills: mocks.loadSkills }));

import { useSkills } from "@/core/skills/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

afterEach(() => {
  cleanup();
  mocks.loadSkills.mockReset();
});

describe("skill catalog read permission", () => {
  it("hides and removes a cached catalog while reads are disabled", async () => {
    const { client, Wrapper } = createWrapper();
    client.setQueryData(["skills"], [{ name: "private-skill" }]);

    const { result } = renderHook(() => useSkills(false), {
      wrapper: Wrapper,
    });

    expect(result.current.skills).toEqual([]);
    expect(result.current.hasData).toBe(false);
    await waitFor(() =>
      expect(client.getQueryData(["skills"])).toBeUndefined(),
    );
    expect(mocks.loadSkills).not.toHaveBeenCalled();
    client.clear();
  });

  it("aborts an in-flight catalog read after permission is withdrawn", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.loadSkills.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const { client, Wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSkills(enabled),
      { initialProps: { enabled: true }, wrapper: Wrapper },
    );

    await waitFor(() => expect(mocks.loadSkills).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(result.current.skills).toEqual([]);
    expect(result.current.hasData).toBe(false);
    client.clear();
  });
});
