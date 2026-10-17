"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { browserStreamURL } from "./api";
import { LatestBrowserFrameBuffer } from "./frame-buffer";

export interface BrowserTab {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export type BrowserInputEvent =
  | { type: "click"; nx: number; ny: number }
  | { type: "move"; nx: number; ny: number }
  | { type: "down"; nx: number; ny: number }
  | { type: "up"; nx: number; ny: number }
  | { type: "wheel"; dx: number; dy: number; nx?: number; ny?: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "activate_tab"; index: number };

export type BrowserStreamStatus = "idle" | "connecting" | "open" | "closed";

const RECONNECT_BASE_DELAY_MS = 800;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_MAX_ATTEMPTS = 6;

function normalizeSeedUrl(url: string | null | undefined): string {
  return (url ?? "").split("#", 1)[0]?.replace(/\/+$/, "") ?? "";
}

/**
 * Manage a live browser screencast WebSocket.
 *
 * When ``enabled`` is true, opens the stream, exposes the latest JPEG frame as
 * an object URL, and returns a ``sendInput`` callback that forwards user input
 * to the live page. Closes and cleans up when disabled or unmounted.
 *
 * ``seedUrl`` is only read when a connection is first established (via a ref, so
 * it is NOT a reconnect trigger). A separate effect steers an already-open live
 * page toward a changed seed with an in-band ``navigate`` event, so ordinary
 * navigations no longer tear down and rebuild the socket.
 */
export function useBrowserStream(
  threadId: string,
  enabled: boolean,
  seedUrl?: string,
  onNavRejected?: (
    url: string | undefined,
    message: string | undefined,
  ) => void,
) {
  const [status, setStatus] = useState<BrowserStreamStatus>("idle");
  const [frameBuffer] = useState(() => new LatestBrowserFrameBuffer());
  const frameUrl = useSyncExternalStore(
    frameBuffer.subscribe,
    frameBuffer.getSnapshot,
    () => null,
  );
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  // This state is only a lifecycle-generation signal. The actual consecutive
  // reconnect count lives in a ref so resetting it after a successful open
  // does not recreate the WebSocket effect.
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const reconnectAttemptRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingNavigateRef = useRef<Extract<
    BrowserInputEvent,
    { type: "navigate" }
  > | null>(null);
  // Read the seed at connect time only; it must not be a reconnect dependency.
  const seedRef = useRef(seedUrl);
  // Latest live page URL reported by the server, used to decide whether an
  // open stream already shows the seed target (avoids redundant navigations).
  const liveUrlRef = useRef<string | null>(null);
  const onNavRejectedRef = useRef(onNavRejected);

  // 禁用期渲染期条件重置（官方 adjusting-state 模式，条件自灭）：state
  // 在同一提交内生效；ref 写与缓冲清理留在下方 commit 后 effect（渲染期
  // 不写 ref）。enabled=false 稳态下所有条件为假，不再触发。
  if (!enabled) {
    if (reconnectGeneration !== 0) {
      setReconnectGeneration(0);
    }
    if (liveUrl !== null) {
      setLiveUrl(null);
    }
    if (tabs.length > 0) {
      setTabs([]);
    }
    if (status !== "idle") {
      setStatus("idle");
    }
  }

  // seed/回调最新值缓存：渲染期不写 ref，commit 后同步（P351 同款模式）。
  // 读取方均为 effect/事件回调，且本 effect 声明在 WebSocket effect 之前，
  // 按声明顺序先同步再连接，无渲染与提交之间的读取窗口。
  useEffect(() => {
    seedRef.current = seedUrl;
  });
  useEffect(() => {
    onNavRejectedRef.current = onNavRejected;
  });

  const sendInput = useCallback((event: BrowserInputEvent) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return true;
    }
    // URL bar submissions are user intent and must not be lost during the
    // short Live connection window right after opening the panel.
    if (event.type === "navigate") {
      pendingNavigateRef.current = event;
    }
    return false;
  }, []);

  useEffect(() => {
    pendingNavigateRef.current = null;
  }, [threadId]);

  useEffect(() => {
    if (enabled) {
      return;
    }
    // state 部分已在上方渲染期条件重置；这里只做渲染期不允许的 ref 写
    // 与外部缓冲清理。
    reconnectAttemptRef.current = 0;
    frameBuffer.dispose();
    liveUrlRef.current = null;
  }, [enabled, frameBuffer, threadId]);

  useEffect(() => {
    if (!enabled) {
      liveUrlRef.current = null;
      return;
    }

    let closedByEffect = false;
    let reconnectTimer: number | null = null;
    // 论证保留 effect 内 setState（react-hooks/set-state-in-effect）：
    // "connecting" 是 WebSocket 生命周期状态机的入口转换，语义绑定本
    // effect 的重新执行（重连 generation++ 或 threadId 切换时回到
    // connecting）；渲染期条件无法表达"effect 将重跑"这一时机——open
    // 稳态下任何重渲染都会被错误拉回 connecting。onopen/onclose 的
    // setStatus 均在外部系统事件回调内，属合法的订阅镜像。
    setStatus("connecting");
    // browserStreamURL treats empty/undefined seed identically (no seed param),
    // so the raw ref value is fine here. Record the seed optimistically so the
    // "steer to seed" effect below does not fire a duplicate navigate right
    // after open (the server already aligns the page to the connect-time seed).
    liveUrlRef.current = seedRef.current ?? null;
    const socket = new WebSocket(browserStreamURL(threadId, seedRef.current));
    socket.binaryType = "blob";
    socketRef.current = socket;

    const scheduleReconnect = () => {
      if (closedByEffect || !enabled) {
        return;
      }
      if (reconnectTimer !== null) {
        return;
      }
      // Exponential backoff with a ceiling + attempt cap so a server that keeps
      // rejecting the upgrade cannot pin the client in a tight reconnect loop.
      const attempt = reconnectAttemptRef.current;
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        return;
      }
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** attempt,
        RECONNECT_MAX_DELAY_MS,
      );
      reconnectTimer = window.setTimeout(() => {
        reconnectAttemptRef.current += 1;
        setReconnectGeneration((generation) => generation + 1);
      }, delay);
    };

    socket.onopen = () => {
      const pendingNavigate = pendingNavigateRef.current;
      if (pendingNavigate) {
        socket.send(JSON.stringify(pendingNavigate));
        pendingNavigateRef.current = null;
      }
      // Reset the reconnect budget on a successful open. Without this the
      // cumulative attempt counter never returns to 0 while the panel stays
      // mounted, so after RECONNECT_MAX_ATTEMPTS total reconnects — even across
      // many healthy connections — scheduleReconnect would bail forever and
      // Live would go permanently dead until the panel is toggled off/on.
      reconnectAttemptRef.current = 0;
      setStatus("open");
    };
    socket.onmessage = (message) => {
      try {
        if (closedByEffect) return;
        if (message.data instanceof Blob) {
          frameBuffer.push(
            message.data.type === "image/jpeg"
              ? message.data
              : new Blob([message.data], { type: "image/jpeg" }),
          );
          return;
        }
        if (message.data instanceof ArrayBuffer) {
          frameBuffer.push(new Blob([message.data], { type: "image/jpeg" }));
          return;
        }
        if (typeof message.data !== "string") return;

        const payload = JSON.parse(message.data) as {
          type?: string;
          data?: string;
          url?: string;
          message?: string;
          tabs?: BrowserTab[];
        };
        if (payload.type === "frame" && payload.data) {
          frameBuffer.replaceWithUrl(`data:image/jpeg;base64,${payload.data}`);
        } else if (payload.type === "url" && payload.url) {
          liveUrlRef.current = payload.url;
          setLiveUrl(payload.url);
        } else if (payload.type === "tabs" && Array.isArray(payload.tabs)) {
          setTabs(payload.tabs);
        } else if (payload.type === "nav_rejected") {
          onNavRejectedRef.current?.(payload.url, payload.message);
        }
      } catch (error) {
        console.warn("Ignoring malformed browser stream message", error);
      }
    };
    socket.onclose = () => {
      if (!closedByEffect) {
        setStatus("closed");
        scheduleReconnect();
      }
    };
    socket.onerror = () => {
      if (!closedByEffect) {
        setStatus("closed");
        scheduleReconnect();
      }
    };

    return () => {
      closedByEffect = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current = null;
      socket.close();
      frameBuffer.dispose();
    };
  }, [reconnectGeneration, enabled, frameBuffer, threadId]);

  // Steer an already-open stream toward a changed seed in-band instead of
  // rebuilding the socket. Only navigates when the live page differs from the
  // seed target, so redirects/history moves the server already reflects do not
  // cause a redundant navigation loop.
  useEffect(() => {
    if (!enabled || status !== "open") {
      return;
    }
    const target = seedUrl?.trim();
    if (!target) {
      return;
    }
    if (normalizeSeedUrl(target) === normalizeSeedUrl(liveUrlRef.current)) {
      return;
    }
    sendInput({ type: "navigate", url: target });
  }, [enabled, seedUrl, sendInput, status]);

  return { status, frameUrl, liveUrl, tabs, sendInput };
}
