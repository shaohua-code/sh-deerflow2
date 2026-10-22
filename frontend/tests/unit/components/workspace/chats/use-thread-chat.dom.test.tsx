import { expect, rs, test } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

const navigation = rs.hoisted(() => ({
  pathname: "/workspace/chats/thread-1",
  threadId: "thread-1",
}));

rs.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => ({ thread_id: navigation.threadId }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
}));

function setBrowserPath(path: string) {
  window.history.replaceState(null, "", path);
}

test("navigating to /new does not mint a new thread id every render", async () => {
  navigation.pathname = "/workspace/chats/thread-1";
  navigation.threadId = "thread-1";
  setBrowserPath("/workspace/chats/thread-1");
  const { useThreadChat } =
    await import("@/components/workspace/chats/use-thread-chat");
  const { result, rerender } = renderHook(() => useThreadChat());
  const existingId = result.current.threadId;
  expect(existingId).toBe("thread-1");

  navigation.pathname = "/workspace/chats/new";
  navigation.threadId = "new";
  setBrowserPath("/workspace/chats/new");
  rerender();
  const mintedId = result.current.threadId;
  expect(mintedId).not.toBe("thread-1");
  expect(mintedId).toBeTruthy();
  expect(result.current.isNewThread).toBe(true);

  rerender();
  rerender();
  expect(result.current.threadId).toBe(mintedId);
});

test("replaceState after send keeps the created thread id while Next still says /new", async () => {
  navigation.pathname = "/workspace/chats/new";
  navigation.threadId = "new";
  setBrowserPath("/workspace/chats/new");
  const { useThreadChat } =
    await import("@/components/workspace/chats/use-thread-chat");
  const { result, rerender } = renderHook(() => useThreadChat());
  const mintedId = result.current.threadId;
  expect(result.current.isNewThread).toBe(true);
  expect(mintedId).toBeTruthy();

  const createdThreadId = "a89a6f26-b6da-41a5-a399-e6b41d908d55";
  act(() => {
    // ChatPage onStart：原生 replaceState 更新地址栏，Next 路由树不重挂。
    setBrowserPath(`/workspace/chats/${createdThreadId}`);
    result.current.setThreadId(createdThreadId);
    result.current.setIsNewThread(false);
  });
  rerender();
  rerender();
  rerender();

  expect(window.location.pathname).toBe(`/workspace/chats/${createdThreadId}`);
  expect(navigation.pathname).toBe("/workspace/chats/new");
  expect(navigation.threadId).toBe("new");
  expect(result.current.threadId).toBe(createdThreadId);
  expect(result.current.isNewThread).toBe(false);
});
