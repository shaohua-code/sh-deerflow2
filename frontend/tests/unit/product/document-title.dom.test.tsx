import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ fetchProductBootstrap: rs.fn() }));

rs.mock("@/product/api", () => ({
  fetchProductBootstrap: mocks.fetchProductBootstrap,
}));

import { I18nProvider } from "@/core/i18n/context";
import { ProductDocumentTitle } from "@/product/document-title";

function createWrapper(locale: "en-US" | "zh-CN", client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <I18nProvider initialLocale={locale}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nProvider>
    );
  };
}

beforeEach(() => {
  mocks.fetchProductBootstrap.mockResolvedValue({
    api_version: 1,
    product: {
      name: "Acme Research",
      name_zh: "知行研究台",
      features: {
        overview: true,
        chats: true,
        agents: true,
        scheduled_tasks: true,
        capabilities: true,
        files: false,
        data_privacy: false,
        administration: true,
      },
    },
    user: { id: "admin-1", is_admin: true },
  });
});

afterEach(() => {
  cleanup();
  document.title = "";
  document.cookie = "locale=; Max-Age=0; path=/";
  rs.clearAllMocks();
});

describe("ProductDocumentTitle", () => {
  it("uses the configured English product name", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    document.cookie = "locale=en-US; path=/";
    render(<ProductDocumentTitle />, {
      wrapper: createWrapper("en-US", client),
    });

    await waitFor(() => expect(document.title).toBe("Acme Research"));
  });

  it("uses the configured localized brand and follows admin cache updates", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // 与真实首屏相同，由已保存的语言 Cookie 决定组件初始化语言。
    document.cookie = "locale=zh-CN; path=/";
    render(<ProductDocumentTitle />, {
      wrapper: createWrapper("zh-CN", client),
    });

    await waitFor(() => expect(document.title).toBe("知行研究台"));

    client.setQueryData(["product", "bootstrap"], {
      name: "Northstar Desk",
      name_zh: "北辰工作台",
      features: {
        overview: true,
        chats: true,
        agents: true,
        scheduled_tasks: true,
        capabilities: true,
        files: false,
        data_privacy: false,
        administration: true,
      },
    });

    await waitFor(() => expect(document.title).toBe("北辰工作台"));
  });

  it("keeps the localized source brand when product bootstrap is unavailable", async () => {
    mocks.fetchProductBootstrap.mockRejectedValueOnce(
      new Error("Gateway is unavailable"),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    document.cookie = "locale=zh-CN; path=/";
    render(<ProductDocumentTitle />, {
      wrapper: createWrapper("zh-CN", client),
    });

    await waitFor(() => expect(document.title).toBe("智能工作台"));
  });
});
