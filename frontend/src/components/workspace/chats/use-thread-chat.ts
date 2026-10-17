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
  // Render-time values use the committed browser URL. The sync logic below
  // intentionally watches the reactive pathname so client navigation still
  // schedules a reset when window.location is stale during render.
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

  // 路由身份同步：官方 adjusting-state-when-props-change 模式替代 effect 内
  // 同步 setState（避免级联渲染）。每个字段仅在偏离期望值时更新，条件自灭，
  // 无渲染循环；返回值在同一次提交内即为新值，比旧 effect 快一拍。
  if (pathname.endsWith("/new")) {
    const nextThreadId = newThreadId ?? uuid();
    if (newThreadId === null) {
      setNewThreadId(nextThreadId);
    }
    if (!isNewThreadState) {
      setIsNewThreadState(true);
    }
    if (threadId !== nextThreadId) {
      setThreadIdState(nextThreadId);
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
