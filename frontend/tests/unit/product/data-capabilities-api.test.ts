import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const mocks = rs.hoisted(() => ({ fetch: rs.fn(), staticMode: false }));

rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/static-mode", () => ({
  isStaticWebsiteOnly: () => mocks.staticMode,
}));

import {
  fetchProductDataCapabilities,
  isProductDataCapabilities,
} from "@/product/api";

const validCapabilities = {
  api_version: 1,
  deletion_scopes: {
    preferences: true,
    memory: false,
    files: true,
    threads: false,
    projects: true,
    agents: false,
    scheduled_tasks: true,
  },
};

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.staticMode = false;
});

describe("product data-capability contract", () => {
  it("accepts exactly seven explicit boolean deletion scopes", () => {
    expect(isProductDataCapabilities(validCapabilities)).toBe(true);
  });

  it.each([
    null,
    [],
    { ...validCapabilities, api_version: 2 },
    { ...validCapabilities, private_configuration: {} },
    { api_version: 1, deletion_scopes: {} },
    {
      ...validCapabilities,
      deletion_scopes: { ...validCapabilities.deletion_scopes, memory: "true" },
    },
    {
      ...validCapabilities,
      deletion_scopes: { ...validCapabilities.deletion_scopes, files: null },
    },
    {
      ...validCapabilities,
      deletion_scopes: { ...validCapabilities.deletion_scopes, account: true },
    },
    {
      ...validCapabilities,
      deletion_scopes: {
        ...validCapabilities.deletion_scopes,
        threads: undefined,
      },
    },
  ])(
    "rejects malformed, incomplete, or expanded capabilities: %j",
    (payload) => {
      expect(isProductDataCapabilities(payload)).toBe(false);
    },
  );

  it("does not treat inherited scope flags as a validated capability", () => {
    expect(
      isProductDataCapabilities({
        api_version: 1,
        deletion_scopes: Object.create(validCapabilities.deletion_scopes),
      }),
    ).toBe(false);
  });
});

describe("product data-capability fetch", () => {
  it("uses the authenticated API and forwards the lifecycle AbortSignal", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify(validCapabilities)),
    );
    const controller = new AbortController();
    await expect(
      fetchProductDataCapabilities(controller.signal),
    ).resolves.toEqual(validCapabilities);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/product/v1/data-capabilities",
      {
        signal: controller.signal,
      },
    );
  });

  it("rejects unsupported responses instead of guessing support", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ api_version: 1, deletion_scopes: {} })),
    );
    await expect(fetchProductDataCapabilities()).rejects.toThrow(
      "The product data-capability API returned an unsupported response",
    );
  });

  it("keeps failed request details out of its error message", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "private-backend-configuration" }),
        {
          status: 503,
        },
      ),
    );
    await expect(fetchProductDataCapabilities()).rejects.toThrow(
      "Unable to load data capabilities (503)",
    );
  });

  it("rejects static mode before making a network request", async () => {
    mocks.staticMode = true;
    await expect(fetchProductDataCapabilities()).rejects.toThrow(/static demo/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
