import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  userId: null as string | null,
  fetchIamResources: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.userId === null ? null : { id: mocks.userId } }),
}));
rs.mock("@/core/static-mode", () => ({ isStaticWebsiteOnly: () => false }));
rs.mock("@/product/api", () => ({
  fetchIamResources: (...args: unknown[]) => mocks.fetchIamResources(...args),
}));

import {
  IAM_RESOURCES_QUERY_KEY,
  useIamButton,
  useIamResourceControl,
} from "@/product/hooks";
import { IAM_BUTTON_CODES } from "@/product/iam-resources";

const CHAT_CREATE = IAM_BUTTON_CODES.chatCreate;

function renderControl(client: QueryClient) {
  return renderHook(
    () => ({
      control: useIamResourceControl(),
      canCreateChat: useIamButton(CHAT_CREATE),
    }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  mocks.userId = null;
  mocks.fetchIamResources.mockReset();
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("useIamResourceControl", () => {
  it("treats a signed-out visitor as uncontrolled and sends no request", () => {
    const { result } = renderControl(new QueryClient());

    expect(result.current.control).toBeNull();
    expect(result.current.canCreateChat).toBe(true);
    expect(mocks.fetchIamResources).not.toHaveBeenCalled();
  });

  it("grants nothing until the first lookup resolves, then follows the granted codes", async () => {
    mocks.userId = "user-1";
    // 解析中：受控结果未知，受控项一律不放行，避免先闪现后收起。
    let resolve: (value: unknown) => void = () => undefined;
    mocks.fetchIamResources.mockReturnValue(
      new Promise<unknown>((settle) => {
        resolve = settle;
      }),
    );
    const { result } = renderControl(new QueryClient());

    expect(result.current.control).toBeUndefined();
    expect(result.current.canCreateChat).toBe(false);

    resolve({
      controlled: true,
      menus: ["deerflow.chats"],
      buttons: [CHAT_CREATE],
    });
    await waitFor(() =>
      expect(result.current.control).toEqual({
        menus: ["deerflow.chats"],
        buttons: [CHAT_CREATE],
      }),
    );
    expect(result.current.canCreateChat).toBe(true);
  });

  it("hides a button the IAM resource tree did not grant", async () => {
    mocks.userId = "user-1";
    mocks.fetchIamResources.mockResolvedValue({
      controlled: true,
      menus: ["deerflow.chats"],
      buttons: [],
    });
    const { result } = renderControl(new QueryClient());

    await waitFor(() =>
      expect(result.current.control).toEqual({
        menus: ["deerflow.chats"],
        buttons: [],
      }),
    );
    expect(result.current.canCreateChat).toBe(false);
  });

  it("shows everything when IAM reports the session as uncontrolled", async () => {
    mocks.userId = "user-1";
    mocks.fetchIamResources.mockResolvedValue({
      controlled: false,
      menus: [],
      buttons: [],
    });
    const { result } = renderControl(new QueryClient());

    await waitFor(() => expect(result.current.control).toBeNull());
    expect(result.current.canCreateChat).toBe(true);
  });

  it("falls back to uncontrolled when the first lookup fails", async () => {
    mocks.userId = "user-1";
    mocks.fetchIamResources.mockRejectedValue(new Error("gateway down"));
    const { result } = renderControl(new QueryClient());

    await waitFor(() => expect(result.current.control).toBeNull());
    expect(result.current.canCreateChat).toBe(true);
  });

  it("does not reuse the previous account's grants after an identity switch", async () => {
    mocks.userId = "user-1";
    mocks.fetchIamResources.mockResolvedValue({
      controlled: true,
      menus: ["deerflow.chats"],
      buttons: [CHAT_CREATE],
    });
    const { result, rerender } = renderControl(new QueryClient());
    await waitFor(() => expect(result.current.canCreateChat).toBe(true));

    // 切到另一个账号：新账号的结果还没回来，不能沿用上一个账号的授权。
    mocks.fetchIamResources.mockReturnValue(new Promise(() => undefined));
    mocks.userId = "user-2";
    rerender();

    expect(result.current.control).toBeUndefined();
    expect(result.current.canCreateChat).toBe(false);
  });

  it("keeps the last granted snapshot when a background refresh fails", async () => {
    mocks.userId = "user-1";
    const client = new QueryClient();
    client.setQueryData([...IAM_RESOURCES_QUERY_KEY, "user-1"], {
      controlled: true,
      menus: ["deerflow.chats"],
      buttons: [],
    });
    mocks.fetchIamResources.mockRejectedValue(new Error("iam unreachable"));
    const { result } = renderControl(client);
    expect(result.current.control).toEqual({
      menus: ["deerflow.chats"],
      buttons: [],
    });

    await act(async () => {
      await client.refetchQueries({ queryKey: IAM_RESOURCES_QUERY_KEY });
    });
    expect(client.getQueryState([...IAM_RESOURCES_QUERY_KEY, "user-1"])?.status).toBe(
      "error",
    );
    // 后台刷新失败不能放宽权限：仍沿用上一次成功的授权快照。
    expect(result.current.control).toEqual({
      menus: ["deerflow.chats"],
      buttons: [],
    });
    expect(result.current.canCreateChat).toBe(false);
  });
});
