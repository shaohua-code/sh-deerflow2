import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  fetchPublicProductBrand: rs.fn(),
  pathname: "/",
}));

rs.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

rs.mock("@/product/api", () => ({
  fetchPublicProductBrand: mocks.fetchPublicProductBrand,
}));

import {
  PublicProductBrandDocumentTitle,
  PublicProductBrandProvider,
  publishPublicProductBrandUpdate,
  usePublicProductBrandName,
} from "@/product/public-brand";

function BrandNames() {
  return (
    <>
      <output aria-label="English product name">
        {usePublicProductBrandName("en-US")}
      </output>
      <output aria-label="中文产品名称">
        {usePublicProductBrandName("zh-CN")}
      </output>
    </>
  );
}

beforeEach(() => {
  mocks.pathname = "/";
  document.title = "Flow Desk";
  document.documentElement.lang = "en-US";
  mocks.fetchPublicProductBrand.mockResolvedValue({
    api_version: 1,
    product: { name: "Northstar Desk", name_zh: "北辰工作台" },
  });
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("public product brand", () => {
  it("starts with the source fallback and then applies the runtime names", async () => {
    let resolveBrand: (value: {
      api_version: 1;
      product: { name: string; name_zh: string };
    }) => void = () => undefined;
    mocks.fetchPublicProductBrand.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBrand = resolve;
      }),
    );

    render(
      <PublicProductBrandProvider>
        <PublicProductBrandDocumentTitle />
        <BrandNames />
      </PublicProductBrandProvider>,
    );

    expect(screen.getByLabelText("English product name").textContent).toBe(
      "Flow Desk",
    );
    expect(screen.getByLabelText("中文产品名称").textContent).toBe(
      "智能工作台",
    );
    expect(document.title).toBe("Flow Desk");

    await act(async () => {
      resolveBrand({
        api_version: 1,
        product: { name: "Northstar Desk", name_zh: "北辰工作台" },
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("English product name").textContent).toBe(
        "Northstar Desk",
      );
      expect(screen.getByLabelText("中文产品名称").textContent).toBe(
        "北辰工作台",
      );
      expect(document.title).toBe("Northstar Desk");
    });

    document.documentElement.lang = "zh-CN";
    await waitFor(() => expect(document.title).toBe("北辰工作台"));
  });

  it("uses the source fallback when the public Gateway endpoint is unavailable", async () => {
    mocks.fetchPublicProductBrand.mockRejectedValueOnce(
      new Error("Gateway is unavailable"),
    );
    render(
      <PublicProductBrandProvider>
        <PublicProductBrandDocumentTitle />
        <BrandNames />
      </PublicProductBrandProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("English product name").textContent).toBe(
        "Flow Desk",
      );
    });

    document.documentElement.lang = "zh-CN";
    await waitFor(() => expect(document.title).toBe("智能工作台"));

    // Next's App Router can re-apply root metadata after client effects mount.
    act(() => {
      document.title = "Flow Desk";
    });
    await waitFor(() => expect(document.title).toBe("智能工作台"));
  });

  it("applies an admin save immediately in the current tab", async () => {
    render(
      <PublicProductBrandProvider>
        <PublicProductBrandDocumentTitle />
        <BrandNames />
      </PublicProductBrandProvider>,
    );
    await screen.findByText("Northstar Desk");

    act(() => {
      publishPublicProductBrandUpdate({
        name: "Updated Desk",
        name_zh: "更新工作台",
      });
    });

    expect(screen.getByLabelText("English product name").textContent).toBe(
      "Updated Desk",
    );
    expect(screen.getByLabelText("中文产品名称").textContent).toBe(
      "更新工作台",
    );
    await waitFor(() => expect(document.title).toBe("Updated Desk"));
  });

  it("leaves route-specific titles unchanged outside product entry pages", async () => {
    mocks.pathname = "/blog/posts";
    document.title = "Research notes";
    render(
      <PublicProductBrandProvider>
        <PublicProductBrandDocumentTitle />
        <BrandNames />
      </PublicProductBrandProvider>,
    );

    await screen.findByText("Northstar Desk");
    expect(document.title).toBe("Research notes");
  });
});
