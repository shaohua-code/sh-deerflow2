"use client";

import { FolderKanban, ShieldCheck, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/core/i18n/hooks";
import { BrandMark } from "@/product/brand-mark";
import { usePublicProductBrandName } from "@/product/public-brand";

const featureIcons = [ShieldCheck, Workflow, FolderKanban] as const;

/**
 * 登录和管理员初始化共用的产品外壳。
 * 中文说明：品牌介绍只放在桌面侧栏，窄屏隐藏以给认证表单留空间；children 保持
 * 原有 Gateway 认证流程不变，后续页面品牌化也只需调整这个自有组件。
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t, locale, changeLocale } = useI18n();
  const brandName = usePublicProductBrandName(locale);

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-slate-100/80 p-4 sm:p-6 dark:bg-slate-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute top-[-8rem] -left-32 size-[28rem] rounded-full bg-blue-300/25 blur-3xl dark:bg-blue-600/10" />
        <div className="absolute right-[-7rem] -bottom-40 size-[32rem] rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-600/10" />
      </div>

      <div className="absolute top-4 right-4 z-20">
        <LocaleSwitcher locale={locale} onLocaleChange={changeLocale} />
      </div>

      <div className="border-border/70 bg-card relative my-auto grid w-full max-w-[1120px] overflow-hidden rounded-[2rem] border shadow-[0_28px_90px_-45px_rgba(15,23,42,0.48)] lg:min-h-[min(780px,calc(100svh-3rem))] lg:grid-cols-[1.04fr_0.96fr]">
        <aside className="relative hidden overflow-hidden bg-[#111d3b] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-16 -right-28 size-96 rounded-full bg-blue-500/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-16 size-80 rounded-full bg-violet-500/15 blur-3xl"
          />

          <div className="relative flex items-center gap-3">
            <BrandMark className="size-11 rounded-2xl" />
            <span
              className="max-w-[18rem] truncate text-lg font-semibold tracking-tight"
              title={brandName}
            >
              {brandName}
            </span>
          </div>

          <div className="relative my-12 max-w-lg">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-blue-100">
              <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
              {t.login.heroKicker}
            </div>
            <h2 className="text-4xl leading-[1.18] font-semibold tracking-[-0.04em] whitespace-pre-line xl:text-5xl">
              {t.login.heroTitle}
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-blue-100/75 xl:text-base">
              {t.login.heroDescription}
            </p>

            <ul className="mt-8 space-y-4">
              {t.login.heroFeatures.map((feature, index) => {
                const Icon = featureIcons[index] ?? ShieldCheck;
                return (
                  <li key={feature} className="flex items-center gap-3 text-sm">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.07] text-blue-100">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="text-white/85">{feature}</span>
                  </li>
                );
              })}
            </ul>

            {/* 纯装饰的流程图形不绑定真实任务状态，也不依赖外部图片资源。 */}
            <div
              aria-hidden="true"
              className="mt-9 rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-slate-950/20 backdrop-blur-sm"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex gap-1.5">
                  <span className="size-2 rounded-full bg-white/25" />
                  <span className="size-2 rounded-full bg-white/25" />
                  <span className="size-2 rounded-full bg-white/25" />
                </div>
                <span className="h-1.5 w-16 rounded-full bg-white/10" />
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
                {[0, 1, 2]
                  .map((step) => (
                    <div
                      key={step}
                      className="rounded-xl border border-white/10 bg-white/[0.06] p-3"
                    >
                      <span className="block text-[10px] font-medium tracking-[0.16em] text-blue-100/55">
                        0{step + 1}
                      </span>
                      <span className="mt-3 block h-1.5 w-4/5 rounded-full bg-white/25" />
                      <span className="mt-2 block h-1.5 w-1/2 rounded-full bg-white/10" />
                    </div>
                  ))
                  .flatMap((step, index) =>
                    index < 2
                      ? [
                          step,
                          <span
                            key={`connector-${index}`}
                            className="h-px w-3 bg-blue-200/40"
                          />,
                        ]
                      : [step],
                  )}
              </div>
            </div>
          </div>

          <p className="relative text-xs leading-5 text-blue-100/55">
            {t.login.heroFooter}
          </p>
        </aside>

        <section
          aria-label={brandName}
          className="relative flex items-center justify-center px-6 py-10 sm:px-10 sm:py-12 md:px-14"
        >
          <div className="w-full max-w-md">{children}</div>
        </section>
      </div>
    </main>
  );
}
