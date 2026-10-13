"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { RememberSessionOption } from "@/components/auth/remember-session-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { loadRememberLoginPreference } from "@/core/auth/remember-login";
import {
  fetchSetupStatus,
  isSystemAlreadyInitializedError,
} from "@/core/auth/setup";
import { parseAuthError } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";

type SetupMode = "loading" | "init_admin" | "change_password" | "unavailable";

export default function SetupPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<SetupMode>("loading");
  const [setupStatusAttempt, setSetupStatusAttempt] = useState(0);

  // 共享表单状态，供首次建号与修改首次登录密码两种模式使用。
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => loadRememberLoginPreference().rememberMe,
  );

  // 仅修改首次登录密码模式会使用当前密码。
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (isAuthenticated && user?.needs_setup) {
      setMode("change_password");
    } else if (!isAuthenticated) {
      // 是否需要创建首个管理员只能由 Gateway 判断；慢响应或失败不能被误当作已初始化。
      setMode("loading");
      void fetchSetupStatus()
        .then((data: { needs_setup?: boolean }) => {
          if (cancelled) return;
          if (data.needs_setup) {
            setMode("init_admin");
          } else {
            // 系统已有账号且当前未登录，回到登录页面。
            router.replace("/login");
          }
        })
        .catch(() => {
          if (!cancelled) setMode("unavailable");
        });
    } else {
      // 已登录且账号不再需要初始化，直接进入工作台。
      router.replace("/workspace");
    }

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, router, setupStatusAttempt]);

  // 首次管理员创建：初始化状态由 Gateway 决定，提交仍沿用现有认证接口。
  const handleInitAdmin = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError(t.settings.account.passwordMismatch);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password: newPassword,
          remember_me: rememberMe,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (isSystemAlreadyInitializedError(data)) {
          router.replace("/login");
          return;
        }
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      router.push("/workspace");
    } catch {
      setError(t.login.networkError);
    } finally {
      setLoading(false);
    }
  };

  // 首次登录改密：继续使用 Gateway CSRF token 和现有会话，不另建产品账号流程。
  const handleChangePassword = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError(t.settings.account.passwordMismatch);
      return;
    }
    if (newPassword.length < 8) {
      setError(t.settings.account.passwordTooShort);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_email: email || undefined,
          remember_me: rememberMe,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      router.push("/workspace");
    } catch {
      setError(t.login.networkError);
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <AuthShell>
        <p className="text-muted-foreground text-center text-sm">
          {t.setup.loading}
        </p>
      </AuthShell>
    );
  }

  if (mode === "unavailable") {
    return (
      <AuthShell>
        <div className="space-y-5 text-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t.login.serviceUnavailableTitle}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {t.login.serviceUnavailableDescription}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={() => {
                setMode("loading");
                setSetupStatusAttempt((attempt) => attempt + 1);
              }}
            >
              {t.login.retry}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.replace("/login")}
            >
              {t.login.signIn}
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  // 首次安装时创建管理员账号。
  if (mode === "init_admin") {
    return (
      <AuthShell>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t.setup.adminTitle}
            </h1>
            <p className="text-muted-foreground mt-1 text-xs">
              {t.setup.adminDescription}
            </p>
          </div>
          <form onSubmit={handleInitAdmin} className="space-y-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t.login.email}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t.setup.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background/70 h-11 rounded-xl"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t.login.password}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder={t.setup.adminPasswordPlaceholder}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-background/70 h-11 rounded-xl"
                required
                minLength={8}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                {t.setup.confirmPassword}
              </label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder={t.setup.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-background/70 h-11 rounded-xl"
                required
                minLength={8}
              />
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
              {loading ? t.setup.creatingAdmin : t.login.createAdminAccount}
            </Button>
          </form>
        </div>
      </AuthShell>
    );
  }

  // 已有账号首次登录时，要求先补全邮箱并更改临时密码。
  return (
    <AuthShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.setup.setupTitle}
          </h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.setup.setupDescription}
          </p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="setup-email" className="text-sm font-medium">
              {t.login.email}
            </label>
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              placeholder={t.setup.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background/70 h-11 rounded-xl"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="currentPassword" className="text-sm font-medium">
              {t.setup.currentPassword}
            </label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              placeholder={t.setup.currentPasswordPlaceholder}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-background/70 h-11 rounded-xl"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="newPassword" className="text-sm font-medium">
              {t.setup.newPassword}
            </label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder={t.setup.newPasswordPlaceholder}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-background/70 h-11 rounded-xl"
              required
              minLength={8}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="confirmNewPassword" className="text-sm font-medium">
              {t.setup.confirmNewPassword}
            </label>
            <Input
              id="confirmNewPassword"
              type="password"
              autoComplete="new-password"
              placeholder={t.setup.confirmNewPasswordPlaceholder}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="bg-background/70 h-11 rounded-xl"
              required
              minLength={8}
            />
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
            {loading ? t.setup.savingPassword : t.setup.completeSetup}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
