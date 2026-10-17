"use client";

import { useRouter, usePathname } from "next/navigation";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

import { isStaticWebsiteOnly } from "../static-mode";

import { type User, buildLoginUrl } from "./types";

// Re-export for consumers
export type { User };

/**
 * Authentication context provided to consuming components
 */
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** /auth/me 暂时不可用时保留身份、清空权限快照，并由工作台提示和重试。 */
  authRefreshUnavailable: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  applyUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  initialUser: User | null;
}

/**
 * AuthProvider - Unified authentication context for the application
 *
 * Per RFC-001:
 * - Only holds display information (user), never JWT or tokens
 * - initialUser comes from server-side guard, avoiding client flicker
 * - Provides logout and refresh capabilities
 */
export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [isLoading, setIsLoading] = useState(false);
  const [authRefreshUnavailable, setAuthRefreshUnavailable] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const staticMode = isStaticWebsiteOnly();

  const isAuthenticated = user !== null;

  /**
   * Apply a user value supplied by a caller (e.g. banner probe) that has
   * already fetched it. Equivalent to setUser, exposed with a stable name
   * so consumers don't reach into React internals.
   */
  const applyUser = useCallback((next: User | null) => {
    setUser(next);
    setAuthRefreshUnavailable(false);
  }, []);

  /**
   * Fetch current user from FastAPI
   * Used when initialUser might be stale (e.g., after tab was inactive)
   */
  const refreshUser = useCallback(async () => {
    if (staticMode) return;

    try {
      setIsLoading(true);
      const res = await fetch("/api/v1/auth/me", {
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setAuthRefreshUnavailable(false);
      } else if (res.status === 401) {
        // Session expired or invalid
        setUser(null);
        setAuthRefreshUnavailable(false);
        // Redirect to login if on a protected route
        if (pathname?.startsWith("/workspace")) {
          router.push(buildLoginUrl(pathname));
        }
      } else {
        // 临时错误不等同于退出登录；撤掉旧授权快照，避免撤权后继续显示受保护数据。
        setUser((current) =>
          current ? { ...current, permissions: [] } : current,
        );
        setAuthRefreshUnavailable(true);
      }
    } catch (err) {
      console.error("Failed to refresh user:", err);
      // 网络中断时保留账号身份，但让所有有明确权限门禁的入口 fail closed。
      setUser((current) =>
        current ? { ...current, permissions: [] } : current,
      );
      setAuthRefreshUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [staticMode, pathname, router]);

  /**
   * Logout - call FastAPI logout endpoint and clear local state
   * Per RFC-001: Immediately clear local state, don't wait for server confirmation
   *
   * When the gateway is unreachable the fetch silently fails — the SPA
   * router.push("/") would leave the user on "/" still holding stale
   * React state and any in-flight SSE / fetch / query subscriptions.
   * We therefore fall back to a hard navigation (window.location.href),
   * which discards all client state the same way the legacy form-POST
   * logout used to.
   */
  const logout = useCallback(async () => {
    // Immediately clear local state to prevent UI flicker
    setUser(null);
    setAuthRefreshUnavailable(false);

    if (staticMode) {
      router.push("/");
      return;
    }

    let logoutFailed = false;
    try {
      const res = await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) logoutFailed = true;
    } catch (err) {
      console.error("Logout request failed:", err);
      logoutFailed = true;
    }

    if (logoutFailed && typeof window !== "undefined") {
      // Hard navigation ensures every in-flight subscription is torn down,
      // matching the legacy form-POST logout behaviour during a gateway outage.
      // 刻意的硬导航：登出请求失败（网关中断）时软导航不重载页面，内存中
      // 的 auth 状态与在途订阅会残留；整页跳转等价旧 form-POST 行为。按行
      // 豁免 next/next 的 location 赋值规则。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 网关中断时的硬导航降级，见上
      window.location.href = "/";
      return;
    }

    // Redirect to home page
    router.push("/");
  }, [staticMode, router]);

  /**
   * Handle visibility change - refresh user when tab becomes visible again.
   * Throttled to at most once per 60 s to avoid spamming the backend on rapid tab switches.
   */
  const lastCheckRef = React.useRef(0);

  useEffect(() => {
    if (staticMode) return;

    const refreshIfStale = () => {
      if (document.visibilityState !== "visible" || user === null) return;
      const now = Date.now();
      if (now - lastCheckRef.current < 60_000) return;
      lastCheckRef.current = now;
      void refreshUser();
    };

    const handleVisibilityChange = () => refreshIfStale();
    // Alt-tab may restore window focus without a visibilitychange event.
    // Re-check the server-owned permission snapshot on that path too.
    const handleWindowFocus = () => refreshIfStale();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [staticMode, user, refreshUser]);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    authRefreshUnavailable,
    logout,
    refreshUser,
    applyUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access authentication context
 * Throws if used outside AuthProvider - this is intentional for proper usage
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Hook to require authentication - redirects to login if not authenticated
 * Useful for client-side checks in addition to server-side guards
 */
export function useRequireAuth(): AuthContextType {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isStaticWebsiteOnly()) return;

    // Only redirect if we're sure user is not authenticated (not just loading)
    if (
      !auth.isLoading &&
      !auth.isAuthenticated &&
      !auth.authRefreshUnavailable
    ) {
      router.push(buildLoginUrl(pathname || "/workspace"));
    }
  }, [
    auth.authRefreshUnavailable,
    auth.isAuthenticated,
    auth.isLoading,
    router,
    pathname,
  ]);

  return auth;
}
