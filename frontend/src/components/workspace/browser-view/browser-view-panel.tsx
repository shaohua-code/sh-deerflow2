"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  Loader2Icon,
  MonitorIcon,
  RadioIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveArtifactURL } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import { isIMEComposing } from "@/lib/ime";
import { cn } from "@/lib/utils";

import { navigateBrowser } from "./api";
import { useMaybeBrowserView } from "./context";
import { decideBrowserKeyInput } from "./keyboard";
import { type BrowserInputEvent, useBrowserStream } from "./use-browser-stream";

export function BrowserViewPanel({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  // 浏览器协议保持上游形状；面板状态和辅助名称统一从产品 locale 读取。
  const { t } = useI18n();
  const browserView = useMaybeBrowserView();
  const frame = browserView?.latestFrame ?? null;
  const imageUrl = frame
    ? resolveArtifactURL(frame.screenshot, threadId)
    : null;

  const [urlInput, setUrlInput] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [live, setLive] = useState(true);
  const [lastLiveUrl, setLastLiveUrl] = useState<string | null>(null);
  const [liveFallback, setLiveFallback] = useState<{
    frameUrl: string;
    url?: string;
  } | null>(null);
  // 渲染期条件修正的 prev 守卫（官方 adjusting-state 模式）：上次处理的
  // threadId（切换时重置 lastLiveUrl）与上次同步进地址栏的非 live url 源
  //（仅源变化时覆盖，保留用户手动编辑）。
  const [prevThreadId, setPrevThreadId] = useState(threadId);
  const [syncedNonLiveUrl, setSyncedNonLiveUrl] = useState<string | null>(null);
  // True while the user is actively editing the URL bar, so background live-URL
  // reports do not clobber a half-typed address the user has not submitted yet.
  // 渲染期需要读取（live URL 同步分支），从 ref 改为 state（P352 同款：
  // 读取发生在渲染期的值用 state 承载；写入均在用户事件回调，合法）。
  const [urlEditing, setUrlEditing] = useState(false);

  const streamSeedUrl = lastLiveUrl ?? liveFallback?.url ?? frame?.url;
  const handleNavRejected = useCallback(
    (url: string | undefined, _message: string | undefined) => {
      setNavigating(false);
      // Gateway 拒绝详情仅用于诊断，界面统一展示稳定的产品提示。
      toast.error(t.browserView.cannotOpen(url));
    },
    [t],
  );
  const { status, frameUrl, liveUrl, sendInput } = useBrowserStream(
    threadId,
    live,
    streamSeedUrl,
    handleNavRejected,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const staticScreenshotRef = useRef<string | null>(null);
  // Handle for the live-navigate spinner timeout so it can be cleared on
  // unmount / re-navigation instead of firing setState after teardown.
  const navSpinnerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navSpinnerTimerRef.current !== null) {
        window.clearTimeout(navSpinnerTimerRef.current);
      }
    };
  }, []);

  // —— 渲染期条件同步（官方 adjusting-state-when-props-change 模式）——
  // 以下各分支仅在偏离期望值时 setState，修正后条件自灭，无渲染循环；
  // state 在同一提交内生效，替代旧 effect 的级联 setState。
  if (prevThreadId !== threadId) {
    setPrevThreadId(threadId);
    setLastLiveUrl(null);
  }
  // 静态帧首次出现时给地址栏播种（urlInput 填充后条件自灭）。
  if (frame?.url && !urlInput && !liveUrl) {
    setUrlInput(frame.url);
  }
  // Keep the URL bar in sync with the latest visible browser state while not
  // live. If the user leaves Live mode, the last streamed frame becomes the
  // static baseline instead of falling back to an older artifact screenshot.
  // 仅在 url 源变化时覆盖，用户手动编辑不被每次渲染重置。
  if (!live) {
    const sourceUrl = liveFallback?.url ?? frame?.url;
    if (sourceUrl && syncedNonLiveUrl !== sourceUrl) {
      setSyncedNonLiveUrl(sourceUrl);
      setUrlInput(sourceUrl);
    }
  }
  // In live mode the server reports the page's real URL (after redirects and
  // history moves). Reconcile the address bar + device-shell label + persisted
  // frame so the top URL never goes stale after navigation. liveFallback 单点
  // 合并计算（等价旧两条 effect 的链式更新），字段级同值跳过避免无效渲染。
  const framedFallback = frameUrl
    ? {
        frameUrl,
        url: liveUrl ?? liveFallback?.url ?? (urlInput || frame?.url),
      }
    : liveFallback;
  const mergedFallback =
    live && liveUrl && framedFallback && framedFallback.url !== liveUrl
      ? { ...framedFallback, url: liveUrl }
      : framedFallback;
  if (live && liveUrl) {
    if (lastLiveUrl !== liveUrl) {
      setLastLiveUrl(liveUrl);
    }
    if (!urlEditing) {
      setUrlInput(liveUrl === "about:blank" ? "" : liveUrl);
    }
    if (navigating) {
      setNavigating(false);
    }
  }
  if (
    mergedFallback?.frameUrl !== liveFallback?.frameUrl ||
    mergedFallback?.url !== liveFallback?.url
  ) {
    setLiveFallback(mergedFallback);
  }

  // New static screenshot arrived: drop the persisted live frame so the static
  // baseline takes over (effect 内 ref 写 + 条件 setState，未被规则报告，保留原形)。
  useEffect(() => {
    const screenshot = frame?.screenshot ?? null;
    if (screenshot && screenshot !== staticScreenshotRef.current) {
      staticScreenshotRef.current = screenshot;
      setLiveFallback(null);
    }
  }, [frame?.screenshot]);

  const handleNavigate = async () => {
    const target = urlInput.trim();
    if (!target) {
      return;
    }
    const normalized = /^https?:\/\//i.test(target)
      ? target
      : `https://${target}`;

    // In live mode, steer the streamed page directly over the socket. The
    // screencast streams continuously, so there is no single "done" frame to
    // key off — show the reload spinner for a brief window so the user gets
    // clear feedback that the navigation actually took. Also sync the URL
    // everywhere immediately (URL bar, device-shell label, persisted frame).
    if (live) {
      sendInput({ type: "navigate", url: normalized });
      setUrlInput(normalized);
      setUrlEditing(false);
      setLiveFallback((prev) => (prev ? { ...prev, url: normalized } : prev));
      setNavigating(true);
      if (navSpinnerTimerRef.current !== null) {
        window.clearTimeout(navSpinnerTimerRef.current);
      }
      navSpinnerTimerRef.current = window.setTimeout(() => {
        navSpinnerTimerRef.current = null;
        setNavigating(false);
      }, 1200);
      return;
    }

    if (navigating) {
      return;
    }
    setNavigating(true);
    try {
      const result = await navigateBrowser(threadId, normalized);
      if (result.screenshot) {
        setLiveFallback(null);
        browserView?.pushFrame({
          screenshot: result.screenshot,
          url: result.url,
          title: result.title,
        });
      } else {
        setUrlInput(result.url);
        toast.warning(t.browserView.navigationNoScreenshot);
      }
      browserView?.openPanel();
    } catch (error) {
      console.error("Failed to navigate browser:", error);
      toast.error(t.browserView.cannotOpen(normalized));
    } finally {
      setNavigating(false);
    }
  };

  const normalizedPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      options?: { fallbackToCenter?: boolean },
    ): { nx: number; ny: number } | null => {
      const el = surfaceRef.current;
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      const natW = el.naturalWidth;
      const natH = el.naturalHeight;
      if (!rect.width || !rect.height || !natW || !natH) {
        return null;
      }
      // The frame is drawn with object-contain: scaled to fit and centered, so
      // there are letterbox bars whenever the panel and remote viewport differ
      // in aspect. Map the pointer against the actual content box.
      const scale = Math.min(rect.width / natW, rect.height / natH);
      const contentW = natW * scale;
      const contentH = natH * scale;
      const offX = (rect.width - contentW) / 2;
      const offY = (rect.height - contentH) / 2;
      const px = clientX - rect.left - offX;
      const py = clientY - rect.top - offY;
      if (px < 0 || py < 0 || px > contentW || py > contentH) {
        if (options?.fallbackToCenter) {
          return { nx: 0.5, ny: 0.5 };
        }
        return null;
      }
      return { nx: px / contentW, ny: py / contentH };
    },
    [],
  );

  const forwardMouse = (
    type: Extract<BrowserInputEvent, { nx: number }>["type"],
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    if (!live) {
      return;
    }
    const point = normalizedPoint(event.clientX, event.clientY);
    if (point) {
      sendInput({ type, ...point });
    }
  };

  const liveActive = live && status === "open";
  const liveConnecting = live && status === "connecting";
  const displayUrl = live
    ? (frameUrl ?? liveFallback?.frameUrl ?? imageUrl)
    : (liveFallback?.frameUrl ?? imageUrl);

  // React registers onWheel as a passive listener, so preventDefault() there is
  // ignored and the wheel scrolls the host chat page. Bind a native, non-passive
  // listener on the always-mounted stage (the <img> may not exist yet when live
  // first opens) so scrolling stays captured inside the remote page.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !liveActive) {
      return;
    }
    let wheelFrame: number | null = null;
    let pendingDx = 0;
    let pendingDy = 0;
    let pendingPoint: { nx: number; ny: number } | null = null;

    const browserWheelDelta = (pixels: number) => {
      return Math.abs(pixels) < 0.25 ? 0 : pixels * 2;
    };

    const flushWheel = () => {
      wheelFrame = null;
      const dx = browserWheelDelta(pendingDx);
      const dy = browserWheelDelta(pendingDy);
      const point = pendingPoint;
      pendingDx = 0;
      pendingDy = 0;
      pendingPoint = null;
      if (dx || dy) {
        sendInput({ type: "wheel", dx, dy, ...(point ?? {}) });
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Normalize deltaMode (line/page → pixels), then batch one animation
      // frame of deltas. A small 2x gain keeps touchpad gestures responsive
      // without returning to the jumpy large-step behavior.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      pendingDx += event.deltaX * unit;
      pendingDy += event.deltaY * unit;
      const point = normalizedPoint(event.clientX, event.clientY, {
        fallbackToCenter: true,
      });
      if (point) {
        pendingPoint = point;
      }
      wheelFrame ??= window.requestAnimationFrame(flushWheel);
    };
    el.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      if (wheelFrame !== null) {
        window.cancelAnimationFrame(wheelFrame);
      }
    };
  }, [liveActive, normalizedPoint, sendInput]);

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={t.browserView.browser}
      className={cn(
        "bg-background relative flex flex-col",
        "size-full",
        className,
      )}
      tabIndex={live ? 0 : undefined}
      onKeyDown={(event) => {
        const target = event.target;
        const editableTarget =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        const input = decideBrowserKeyInput({
          live,
          editableTarget,
          composing: isIMEComposing(event),
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        });
        if (!input) {
          return;
        }
        sendInput(input);
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <MonitorIcon className="size-4 shrink-0" />
        <span className="shrink-0 text-sm font-medium">
          {t.browserView.browser}
        </span>
        <div className="flex shrink-0 items-center">
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            disabled={!live}
            onClick={() => sendInput({ type: "back" })}
            aria-label={t.browserView.back}
            title={t.browserView.back}
          >
            <ArrowLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            disabled={!live}
            onClick={() => sendInput({ type: "forward" })}
            aria-label={t.browserView.forward}
            title={t.browserView.forward}
          >
            <ArrowRightIcon />
          </Button>
        </div>
        <form
          className="relative flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void handleNavigate();
          }}
        >
          <GlobeIcon className="text-muted-foreground pointer-events-none absolute left-2 size-3.5" />
          <Input
            value={urlInput}
            onChange={(event) => {
              setUrlEditing(true);
              setUrlInput(event.target.value);
            }}
            onFocus={(event) => {
              setUrlEditing(true);
              event.currentTarget.select();
            }}
            onBlur={() => {
              setUrlEditing(false);
            }}
            onKeyDown={(event) => {
              // Keep browser select-all/copy/cut/paste working inside the URL
              // bar; stop the panel + global shortcut handlers from swallowing.
              event.stopPropagation();
            }}
            aria-label={t.browserView.urlLabel}
            placeholder={t.browserView.urlPlaceholder}
            spellCheck={false}
            autoComplete="off"
            className="h-8 pl-7 text-xs"
          />
          {navigating && (
            <Loader2Icon className="text-muted-foreground absolute right-2 size-3.5 animate-spin" />
          )}
        </form>
        <Button
          size="sm"
          variant={live ? "default" : "ghost"}
          className="shrink-0 gap-1"
          onClick={() => setLive((prev) => !prev)}
          aria-label={
            live ? t.browserView.stopLiveControl : t.browserView.takeLiveControl
          }
          title={
            live ? t.browserView.stopLiveControl : t.browserView.takeLiveControl
          }
        >
          <RadioIcon className="size-3.5" />
          {live && status !== "open"
            ? t.browserView.connecting
            : t.browserView.live}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={t.browserView.close}
          title={t.browserView.close}
          onClick={() => {
            setLive(false);
            browserView?.close();
          }}
        >
          <XIcon />
        </Button>
      </header>
      <main className="relative flex min-h-0 grow flex-col overflow-hidden bg-neutral-950">
        <div
          ref={stageRef}
          className="relative min-h-0 grow bg-neutral-900"
          onMouseDown={() => {
            panelRef.current?.focus({ preventScroll: true });
          }}
        >
          {displayUrl ? (
            <img
              ref={surfaceRef}
              className="absolute inset-0 h-full w-full cursor-default object-contain object-center"
              src={displayUrl}
              alt={frame?.title ?? t.browserView.screenshotAlt}
              draggable={false}
              onClick={(event) => forwardMouse("click", event)}
            />
          ) : (
            <ConversationEmptyState
              className="absolute inset-0 m-auto h-fit"
              icon={<MonitorIcon />}
              title={
                live
                  ? t.browserView.connectingTitle
                  : t.browserView.noActivityTitle
              }
              description={
                live
                  ? t.browserView.waitingFirstFrame
                  : t.browserView.emptyDescription
              }
            />
          )}
          {(navigating || liveConnecting) && displayUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
              <Loader2Icon className="text-muted-foreground size-8 animate-spin" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
