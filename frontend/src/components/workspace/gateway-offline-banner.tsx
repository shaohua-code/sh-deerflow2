"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { userSchema, type User } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";

import {
  OFFLINE_BANNER_RETRY_INTERVAL_MS,
  classifyProbe,
  decideProbeAction,
  shouldShowOfflineBanner,
} from "./gateway-offline-banner-helpers";

interface GatewayOfflineBannerProps {
  /**
   * True when the server-side auth probe at `/api/v1/auth/me` could not
   * reach the gateway. The banner stays mounted until a client-side probe
   * confirms the gateway is healthy and `user` becomes populated.
   */
  gatewayUnavailable: boolean;
}

export function GatewayOfflineBanner({
  gatewayUnavailable,
}: GatewayOfflineBannerProps) {
  const { t } = useI18n();
  const { user, authRefreshUnavailable, applyUser, refreshUser, logout } =
    useAuth();
  const gatewayIsUnavailable = gatewayUnavailable || authRefreshUnavailable;
  // Guard against piling up probe calls while the gateway is still slow.
  const inFlightRef = useRef(false);
  const [isProbing, setIsProbing] = useState(false);
  // The button reuses the same auth probe as the background recovery timer.
  const retryProbeRef = useRef<() => Promise<void>>(async () => {});
  // Count consecutive 401s so we can distinguish "transient warm-up 401"
  // from "session actually expired" and avoid lying with the banner.
  const authFailuresRef = useRef(0);

  useEffect(() => {
    if (!gatewayIsUnavailable) return;
    // Once AuthProvider has a user again the banner has served its
    // purpose; tear down the polling so we don't keep probing every 10s
    // for the entire lifetime of the page (gatewayUnavailable is a
    // server-rendered prop and stays true until a full reload).
    if (user !== null && !authRefreshUnavailable) return;

    const probe = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsProbing(true);
      let res: Response | null = null;
      let errored = false;
      let parsedUser: User | null = null;
      try {
        res = await fetch("/api/v1/auth/me", {
          credentials: "include",
          cache: "no-store",
        });
        // Reuse the probe's own response body instead of triggering a
        // second /auth/me request via refreshUser() — halves the recovery
        // burst against an already-struggling gateway.
        if (res.ok) {
          try {
            const data = await res.json();
            const parsed = userSchema.safeParse(data);
            if (parsed.success) parsedUser = parsed.data;
          } catch (err) {
            console.warn(
              "[gateway-offline-banner] probe body parse failed:",
              err,
            );
          }
        }
      } catch (err) {
        console.warn("[gateway-offline-banner] probe failed:", err);
        errored = true;
      } finally {
        inFlightRef.current = false;
        setIsProbing(false);
      }

      const action = decideProbeAction(
        authFailuresRef.current,
        classifyProbe(res, errored, parsedUser),
      );

      if (action.type === "apply-user") {
        authFailuresRef.current = 0;
        applyUser(action.user);
        return;
      }
      if (action.type === "delegate-refresh") {
        // Hand off to AuthProvider, which on 401 will /login-redirect.
        authFailuresRef.current = 0;
        await refreshUser();
        return;
      }
      authFailuresRef.current = action.nextFailureCount;
    };

    retryProbeRef.current = probe;
    void probe();
    const handle = window.setInterval(() => {
      void probe();
    }, OFFLINE_BANNER_RETRY_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [
    gatewayIsUnavailable,
    authRefreshUnavailable,
    user,
    applyUser,
    refreshUser,
  ]);

  if (
    !shouldShowOfflineBanner(user, gatewayUnavailable, authRefreshUnavailable)
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-muted text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-sm"
    >
      <span className="min-w-0 flex-1">
        {t.workspace.gatewayUnavailable}{" "}
        {t.workspace.gatewayUnavailableRetrying}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={isProbing}
          aria-busy={isProbing}
          onClick={() => void retryProbeRef.current()}
          className="hover:bg-background rounded-md border px-3 py-1 text-xs disabled:cursor-wait disabled:opacity-60"
        >
          {isProbing ? t.workspace.gatewayRetrying : t.workspace.gatewayRetry}
        </button>
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
          className="hover:bg-background rounded-md border px-3 py-1 text-xs"
        >
          {t.workspace.logout}
        </button>
      </div>
    </div>
  );
}
