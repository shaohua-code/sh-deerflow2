import { expect, test, rs } from "@rstest/core";

const isStaticWebsiteOnly = rs.fn(() => false);

rs.mock("@/core/static-mode", () => ({ isStaticWebsiteOnly }));

test("public branding fetch omits credentials and uses the exact public endpoint", async () => {
  const networkFetch = rs.fn(
    async () =>
      new Response(
        JSON.stringify({
          api_version: 1,
          product: { name: "Northstar Desk", name_zh: "北辰工作台" },
        }),
        { status: 200 },
      ),
  );
  rs.stubGlobal("fetch", networkFetch);

  const { fetchPublicProductBrand } = await import("@/product/api");
  await expect(fetchPublicProductBrand()).resolves.toMatchObject({
    product: { name: "Northstar Desk", name_zh: "北辰工作台" },
  });
  expect(networkFetch).toHaveBeenCalledWith("/api/product/v1/public-brand", {
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: undefined,
  });
});

test("public branding does not call Gateway in static demo mode", async () => {
  isStaticWebsiteOnly.mockReturnValue(true);
  const networkFetch = rs.fn();
  rs.stubGlobal("fetch", networkFetch);

  const { fetchPublicProductBrand } = await import("@/product/api");
  await expect(fetchPublicProductBrand()).rejects.toThrow("static demo mode");
  expect(networkFetch).not.toHaveBeenCalled();
});
