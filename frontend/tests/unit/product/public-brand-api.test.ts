import { afterEach, beforeEach, expect, test, rs } from "@rstest/core";

beforeEach(() => {
  rs.stubEnv("NEXT_PUBLIC_STATIC_WEBSITE_ONLY", undefined);
});

afterEach(() => {
  rs.unstubAllEnvs();
  rs.unstubAllGlobals();
});

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

  const { fetchPublicProductBrand } =
    await import("@/product/public-brand-api");
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
  rs.stubEnv("NEXT_PUBLIC_STATIC_WEBSITE_ONLY", "true");
  const networkFetch = rs.fn();
  rs.stubGlobal("fetch", networkFetch);

  const { fetchPublicProductBrand } =
    await import("@/product/public-brand-api");
  await expect(fetchPublicProductBrand()).rejects.toThrow("static demo mode");
  expect(networkFetch).not.toHaveBeenCalled();
});

test("public branding rejects malformed responses without using them", async () => {
  rs.stubGlobal(
    "fetch",
    rs.fn(
      async () =>
        new Response(
          JSON.stringify({
            api_version: 1,
            product: { name: "Northstar Desk", name_zh: "北辰工作台" },
            user: { id: "private-user" },
          }),
          { status: 200 },
        ),
    ),
  );

  const { fetchPublicProductBrand } =
    await import("@/product/public-brand-api");
  await expect(fetchPublicProductBrand()).rejects.toThrow(
    "unsupported response",
  );
});
