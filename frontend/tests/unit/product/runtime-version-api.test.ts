import { beforeEach, expect, test, rs } from "@rstest/core";

const fetchWithAuth = rs.fn();

rs.mock("@/core/api/fetcher", () => ({ fetch: fetchWithAuth }));

beforeEach(() => fetchWithAuth.mockReset());

test("runtime version lookup uses the authenticated product endpoint", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({
      api_version: 1,
      product: { name: "Flow Desk", version: "1.2.3" },
      engine: { name: "DeerFlow", version: "2.4.0" },
    }),
  });

  const { fetchProductRuntimeVersion } = await import("@/product/api");
  await expect(fetchProductRuntimeVersion()).resolves.toMatchObject({
    product: { version: "1.2.3" },
    engine: { version: "2.4.0" },
  });
  expect(fetchWithAuth).toHaveBeenCalledWith("/api/product/v1/version", {
    signal: undefined,
  });
});

test("runtime version lookup fails closed for an unsupported response", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({ api_version: 2 }),
  });

  const { fetchProductRuntimeVersion } = await import("@/product/api");
  await expect(fetchProductRuntimeVersion()).rejects.toThrow(
    "unsupported version details",
  );
});
