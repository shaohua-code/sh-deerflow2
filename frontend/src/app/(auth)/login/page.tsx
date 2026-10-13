"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { RememberSessionOption } from "@/components/auth/remember-session-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/core/auth/AuthProvider";
import { resolveAuthNextPath } from "@/core/auth/next-path";
import {
  loadRememberLoginPreference,
  saveRememberLoginPreference,
} from "@/core/auth/remember-login";
import {
  canCreateRegularAccount,
  fetchSetupStatus,
  type SetupStatusResponse,
} from "@/core/auth/setup";
import { parseAuthError } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";
import { BrandMark } from "@/product/brand-mark";
import { usePublicProductBrandName } from "@/product/public-brand";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { t, locale } = useI18n();
  const brandName = usePublicProductBrandName(locale);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLogin, setIsLogin] = useState(true);
  const [ssoProviders, setSsoProviders] = useState<
    { id: string; display_name: string; type: string }[]
  >([]);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(
    null,
  );
  const [setupStatusPhase, setSetupStatusPhase] = useState<
    "checking" | "ready" | "unavailable"
  >("checking");
  const [setupStatusAttempt, setSetupStatusAttempt] = useState(0);

  // Extract error from query params (e.g., ?error=sso_failed)
  const errorParam = searchParams.get("error");
  const [error, setError] = useState(
    errorParam
      ? (t.login.errors[errorParam as keyof typeof t.login.errors] ??
          t.login.authFailed)
      : "",
  );
  // Soft hint shown after a failed login when SSO is configured: an SSO-only
  // account has no local password, so the backend returns a generic
  // "incorrect email or password" (deliberately, to avoid account enumeration).
  // Nudge the user toward the SSO buttons without confirming the account exists.
  const [showSsoHint, setShowSsoHint] = useState(false);
  const [loading, setLoading] = useState(false);

  // Get next parameter for validated redirect
  const nextParam = searchParams.get("next");
  const redirectPath = resolveAuthNextPath(nextParam);
  const regularSignupAllowed = canCreateRegularAccount({
    // A failed probe must not expose registration while the system's setup
    // state is unknown. Existing users can still sign in normally.
    checked: setupStatusPhase === "ready",
    status: setupStatus,
  });
  const systemNeedsAdminSetup = setupStatus?.needs_setup === true;
  const showSetupStatusUnavailable =
    setupStatusPhase === "unavailable" ||
    (setupStatusAttempt > 0 && setupStatusPhase === "checking");

  // Redirect if already authenticated (client-side, post-login)
  useEffect(() => {
    if (isAuthenticated) {
      router.push(redirectPath);
    }
  }, [isAuthenticated, redirectPath, router]);

  /* eslint-disable react-hooks/set-state-in-effect -- 浏览器偏好只能在 SSR 水合后读取，以保持首屏服务端标记一致。 */
  useEffect(() => {
    const preference = loadRememberLoginPreference();
    setRememberMe(preference.rememberMe);
    if (preference.email) {
      setEmail(preference.email);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Fetch setup state independently so retrying a slow Gateway does not also
  // refetch unrelated auth-provider configuration.
  useEffect(() => {
    let cancelled = false;

    // 首次状态已是 checking；重试事件会在递增请求序号前切回该状态。
    void fetchSetupStatus()
      .then((data) => {
        if (cancelled) return;
        setSetupStatus(data);
        setSetupStatusPhase("ready");
        if (data.needs_setup) {
          setIsLogin(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSetupStatus(null);
          setSetupStatusPhase("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setupStatusAttempt]);

  // SSO providers are static for the page lifetime and should not be coupled to
  // setup-status retries.
  useEffect(() => {
    let cancelled = false;

    void fetch("/api/v1/auth/providers")
      .then((r) => r.json())
      .then(
        (data: {
          providers: { id: string; display_name: string; type: string }[];
        }) => {
          if (!cancelled) {
            setSsoProviders(data.providers ?? []);
          }
        },
      )
      .catch(() => {
        // Ignore errors; no SSO providers shown
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setShowSsoHint(false);
    setLoading(true);

    if (!isLogin && !regularSignupAllowed) {
      setError(t.login.adminSetupRequiredDescription);
      setLoading(false);
      return;
    }

    try {
      const endpoint = isLogin
        ? "/api/v1/auth/login/local"
        : "/api/v1/auth/register";
      const body = isLogin
        ? new URLSearchParams({
            password,
            remember_me: String(rememberMe),
            username: email,
          })
        : JSON.stringify({ email, password, remember_me: rememberMe });

      const headers: HeadersInit = isLogin
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : { "Content-Type": "application/json" };

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        credentials: "include", // Important: include HttpOnly cookie
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        // On a failed login with SSO configured, surface a hint pointing at the
        // SSO buttons — the "wrong password" may really mean "this is an SSO account".
        if (isLogin && ssoProviders.length > 0) {
          setShowSsoHint(true);
        }
        return;
      }

      saveRememberLoginPreference({ email, rememberMe });

      // Both login and register set a cookie — redirect to workspace
      router.push(redirectPath);
    } catch {
      setError(t.login.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-7">
        <div>
          <div className="mb-8 flex items-center gap-3">
            <BrandMark className="size-12 rounded-2xl" />
            <span
              className="max-w-[16rem] truncate text-sm font-semibold tracking-tight"
              title={brandName}
            >
              {brandName}
            </span>
          </div>
          <h1 className="text-foreground text-3xl font-semibold tracking-[-0.035em]">
            {isLogin ? t.login.signInTitle : t.login.createAccountTitle}
          </h1>
        </div>

        {showSetupStatusUnavailable && (
          <div
            role="status"
            aria-live="polite"
            className="border-l-2 border-amber-500 ps-3 text-sm"
          >
            <p className="font-medium">{t.login.serviceUnavailableTitle}</p>
            <p className="text-muted-foreground mt-1">
              {t.login.serviceUnavailableDescription}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={setupStatusPhase === "checking"}
              onClick={() => {
                setSetupStatusPhase("checking");
                setSetupStatusAttempt((attempt) => attempt + 1);
              }}
            >
              {setupStatusPhase === "checking"
                ? t.login.pleaseWait
                : t.login.retry}
            </Button>
          </div>
        )}

        {systemNeedsAdminSetup && (
          <div className="border-l-2 border-blue-500 ps-3 text-sm">
            <p className="font-medium">{t.login.adminSetupRequiredTitle}</p>
            <p className="text-muted-foreground mt-1">
              {t.login.adminSetupRequiredDescription}
            </p>
            <Link
              href="/setup"
              className="mt-2 inline-block font-medium text-blue-500 hover:underline"
            >
              {t.login.createAdminAccount}
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t.login.email}
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.login.emailPlaceholder}
              className="bg-background/70 h-11 rounded-xl"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t.login.password}
            </label>
            <div className="relative">
              {/* 只切换显示方式，不更改密码值或认证请求；占位文案也不伪装成已填凭据。 */}
              <Input
                id="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.login.passwordPlaceholder}
                className="bg-background/70 h-11 rounded-xl pr-12"
                required
                minLength={isLogin ? 6 : 8}
              />
              <button
                type="button"
                aria-label={
                  passwordVisible ? t.login.hidePassword : t.login.showPassword
                }
                aria-controls="password"
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((visible) => !visible)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring absolute top-1 right-1 flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {passwordVisible ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <RememberSessionOption
            checked={rememberMe}
            onCheckedChange={setRememberMe}
          />

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="text-sm text-red-500"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="shadow-primary/15 h-11 w-full rounded-xl text-sm font-semibold shadow-md"
            disabled={loading}
          >
            {loading
              ? t.login.pleaseWait
              : isLogin
                ? t.login.signIn
                : t.login.createAccount}
          </Button>
        </form>

        {ssoProviders.length > 0 && (
          <div className="space-y-2">
            {isLogin && (
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background text-muted-foreground px-2">
                    {t.login.orContinueWith}
                  </span>
                </div>
              </div>
            )}
            {showSsoHint && (
              <p className="text-muted-foreground text-center text-sm">
                {t.login.ssoHint}
              </p>
            )}
            {ssoProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading}
                onClick={() => {
                  // OAuth 启动接口会响应外部身份提供方跳转，整页导航用于接收回调 Cookie。
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 此处是 OAuth API 入口而非 Next 页面。
                  window.location.href = `/api/v1/auth/oauth/${provider.id}?next=${encodeURIComponent(redirectPath)}&remember_me=${String(rememberMe)}`;
                }}
              >
                {t.login.continueWith(provider.display_name)}
              </Button>
            ))}
          </div>
        )}

        {/* 预留一行高度，避免 Gateway 返回注册策略后登录表单上下跳动。 */}
        <div className="min-h-5 text-center text-sm">
          {regularSignupAllowed && (
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
                setShowSsoHint(false);
              }}
              className="text-blue-500 hover:underline"
            >
              {isLogin ? t.login.noAccountSignUp : t.login.haveAccountSignIn}
            </button>
          )}
        </div>

        <div className="text-muted-foreground text-center text-xs">
          <Link href="/" className="hover:underline">
            {t.login.backToHome}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
