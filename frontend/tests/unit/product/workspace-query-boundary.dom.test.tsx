import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { useQuery } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  userId: "alice",
  fetchOwnerData: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: mocks.userId } }),
}));

import { WorkspaceQueryBoundary } from "@/product/workspace-query-boundary";

function OwnerData() {
  const { data } = useQuery({
    // 模拟尚未按账号分区的旧业务查询键；隔离必须由工作台边界保证。
    queryKey: ["owner-data"],
    queryFn: () => mocks.fetchOwnerData(mocks.userId),
    staleTime: Infinity,
  });
  return (
    <>
      <p>{data ?? "正在加载"}</p>
      <input aria-label="账号草稿" defaultValue="" />
    </>
  );
}

afterEach(() => {
  cleanup();
  mocks.fetchOwnerData.mockReset();
  mocks.userId = "alice";
});

describe("WorkspaceQueryBoundary", () => {
  it("drops the previous account's cache before the new account responds", async () => {
    let completeBob: (value: string) => void = () => undefined;
    mocks.fetchOwnerData.mockImplementation((userId: string) =>
      userId === "bob"
        ? new Promise<string>((resolve) => {
            completeBob = resolve;
          })
        : Promise.resolve(`数据：${userId}`),
    );

    const view = render(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("数据：alice")).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "账号草稿" }), {
      target: { value: "Alice 未提交内容" },
    });

    mocks.userId = "bob";
    view.rerender(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );

    expect(screen.queryByText("数据：alice")).toBeNull();
    expect(screen.getByText("正在加载")).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "账号草稿" }) as HTMLInputElement)
        .value,
    ).toBe("");
    completeBob("数据：bob");
    expect(await screen.findByText("数据：bob")).toBeDefined();

    mocks.userId = "alice";
    view.rerender(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );
    await waitFor(() => expect(mocks.fetchOwnerData).toHaveBeenCalledTimes(3));
  });
});
