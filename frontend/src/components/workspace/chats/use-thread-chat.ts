"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SHOWCASE_ROUTE_PREFIX } from "@/core/threads/static-demo";
import { uuid } from "@/core/utils/uuid";

export const THREAD_CHAT_RESET_EVENT = "deer-flow:thread-chat-reset";

type ThreadChatResetDetail = {
  deletedThreadId: string;
  nextPath: string;
  force?: boolean;
};

export function resetThreadChatAfterDelete(detail: ThreadChatResetDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ThreadChatResetDetail>(THREAD_CHAT_RESET_EVENT, {
      detail,
    }),
  );
}

// Sentinel distinguishing "no identity minted yet" from a minted identity
// whose scope is a project-less new chat (project === null).
const NEW_CHAT_SCOPE_UNSET = Symbol("deerflow.newChatScopeUnset");

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const pathname = usePathname();
  // 渲染期身份与返回值都看已提交的浏览器 URL。Next usePathname 在
  // history.replaceState 后会落后一拍，不能用来决定是否还在 /new。
  const actualPathname =
    typeof window === "undefined" ? pathname : window.location.pathname;
  const isNewPath = actualPathname.endsWith("/new");
  // new-chat 身份从 ref 改为 state：其读取均发生在渲染期（useState 初始化
  // 与返回值），state 天然渲染可见，满足编译器"渲染期不读写 ref"约束，
  // 语义不变（仍是同一身份值跨渲染保持）。
  const [newThreadId, setNewThreadId] = useState<string | null>(
    threadIdFromPath === "new" ? uuid() : null,
  );

  const searchParams = useSearchParams();
  const [threadId, setThreadIdState] = useState(() => {
    return threadIdFromPath === "new"
      ? (newThreadId ?? uuid())
      : threadIdFromPath;
  });

  const [isNewThreadState, setIsNewThreadState] = useState(
    () => threadIdFromPath === "new",
  );

  // 路由身份同步看已提交的浏览器 URL（isNewPath），不要用 Next usePathname。
  // onStart 用 history.replaceState 把地址改成真实 thread 后，路由树不重挂，
  // usePathname/useParams 仍可能停在 /new；若按 pathname 再 mint，会覆盖刚
  // 创建的 id 并把 isNewThread 拉回 true，正在流的回复从 UI 消失。
  // 每个字段仅在偏离期望值时更新，条件自灭。
  if (isNewPath) {
    // 只在尚未铸造时 mint；函数式 updater 保证编译器/严格模式重跑不会每次 uuid()。
    // 不要写成 `newThreadId ?? uuid()` 再去和 threadId 比较——newThreadId 仍为
    // null 时每次渲染都是新 id，会触发 Too many re-renders。
    if (newThreadId === null) {
      setNewThreadId((current) => current ?? uuid());
    }
    if (!isNewThreadState) {
      setIsNewThreadState(true);
    }
    if (newThreadId !== null && threadId !== newThreadId) {
      setThreadIdState(newThreadId);
    }
  } else {
    if (newThreadId !== null) {
      setNewThreadId(null);
    }
    // Native history updates the canonical pathname but preserves the route
    // tree, so useParams may still return the stale "new" value. Avoid passing
    // it to downstream hooks (e.g. useStream), which would cause a 422.
    if (threadIdFromPath !== "new") {
      if (isNewThreadState) {
        setIsNewThreadState(false);
      }
      if (threadId !== threadIdFromPath) {
        setThreadIdState(threadIdFromPath);
      }
    } else if (isNewThreadState) {
      // replaceState 已离开 /new，params 仍可能是 "new"；保留 threadId，只收新会话标记。
      setIsNewThreadState(false);
    }
  }

  const resetToNewThread = useCallback(() => {
    const nextThreadId = uuid();
    setNewThreadId(nextThreadId);
    setIsNewThreadState(true);
    setThreadIdState(nextThreadId);
  }, []);

  // A new-chat identity is minted for the entry scope (the new chat's
  // `project` query). The sidebar "New chat" link can leave
  // `/new?project=…` for plain `/new` without a pathname change, so the
  // pathname sync above keeps the old identity — which may already be
  // pre-created under the previous project, and whose in-flight submission
  // would otherwise survive the navigation. Re-mint whenever the project
  // scope changes while still on a new-chat path.
  const newChatScopeRef = useRef<string | null | symbol>(NEW_CHAT_SCOPE_UNSET);
  useEffect(() => {
    const project = isNewPath ? searchParams.get("project") : null;
    if (!isNewPath) {
      newChatScopeRef.current = NEW_CHAT_SCOPE_UNSET;
      return;
    }
    if (newChatScopeRef.current === project) {
      return;
    }
    const previousScope = newChatScopeRef.current;
    newChatScopeRef.current = project;
    if (previousScope === NEW_CHAT_SCOPE_UNSET) {
      return;
    }
    // Scope changed (project added, removed, or swapped): the old identity
    // belongs to the previous scope, so allocate a fresh one. The threadId
    // flip also runs every fence keyed on `threadId` (composer goal aborts,
    // chat-page submission epoch).
    const nextThreadId = uuid();
    setNewThreadId(nextThreadId);
    setIsNewThreadState(true);
    setThreadIdState(nextThreadId);
  }, [isNewPath, pathname, searchParams]);

  useEffect(() => {
    const handleReset = (event: Event) => {
      const detail = (event as CustomEvent<ThreadChatResetDetail>).detail;
      if (!detail?.nextPath) {
        return;
      }

      const currentPathname = window.location.pathname;
      const isDeletingCurrentThread =
        detail.force === true ||
        detail.deletedThreadId === threadId ||
        detail.deletedThreadId === threadIdFromPath ||
        currentPathname.endsWith(`/${detail.deletedThreadId}`);

      if (!isDeletingCurrentThread) {
        return;
      }

      // URL replacement is owned by the caller's Next router action; this hook
      // only resets local chat state so the router state and browser URL stay
      // in sync.
      resetToNewThread();
    };

    window.addEventListener(THREAD_CHAT_RESET_EVENT, handleReset);
    return () =>
      window.removeEventListener(THREAD_CHAT_RESET_EVENT, handleReset);
  }, [resetToNewThread, threadId, threadIdFromPath]);

  const setThreadId = useCallback((nextThreadId: string) => {
    setNewThreadId(null);
    setThreadIdState(nextThreadId);
  }, []);

  const setIsNewThread = useCallback((nextIsNewThread: boolean) => {
    if (!nextIsNewThread) {
      setNewThreadId(null);
    }
    setIsNewThreadState(nextIsNewThread);
  }, []);

  const isMock =
    actualPathname.startsWith(`${SHOWCASE_ROUTE_PREFIX}/`) ||
    searchParams.get("mock") === "true";
  return {
    threadId: isNewPath ? (newThreadId ?? threadId) : threadId,
    setThreadId,
    isNewThread: isNewPath ? true : isNewThreadState,
    setIsNewThread,
    isMock,
  };
}
