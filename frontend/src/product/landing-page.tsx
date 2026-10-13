import {
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Layers3,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { LocaleSwitcher } from "@/components/locale-switcher";

import { productBrand } from "./brand";
import { BrandMark } from "./brand-mark";
import { getProductCopy } from "./copy";
import { PublicProductBrandName } from "./public-brand";

/**
 * 自有公开首页的页面组合层，app/page.tsx 负责将根路由接入这里。
 * 品牌名可从匿名白名单 API 更新，其他内容使用本地双语文案；登录与工作台链接仍沿用现有路由。
 */
export function ProductLandingPage({ locale }: { locale: "en-US" | "zh-CN" }) {
  const copy = getProductCopy(locale);

  return (
    <main className="bg-background text-foreground min-h-screen overflow-hidden">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-5 py-5 sm:gap-3 sm:px-8 lg:px-12">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <PublicProductBrandName
            locale={locale}
            className="max-w-[12rem] truncate text-[15px] font-semibold tracking-tight"
          />
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <LocaleSwitcher
            locale={locale}
            className="h-8 gap-1 px-2 sm:h-9 sm:gap-2 sm:px-3"
          />
          <Link
            href="/login"
            className="text-muted-foreground hover:bg-muted hover:text-foreground hidden rounded-xl px-4 py-2.5 text-sm font-medium transition-colors sm:inline-flex"
          >
            {copy.signIn}
          </Link>
          <Link
            href="/workspace"
            // 移动端首屏已经有主入口；隐藏重复的顶部按钮，为品牌名和语言切换留出宽度。
            className="bg-primary text-primary-foreground hidden items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:opacity-90 sm:inline-flex"
          >
            <span className="max-[359px]:sr-only min-[360px]:not-sr-only">
              {copy.enterWorkspace}
            </span>
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 pt-14 pb-20 sm:px-8 sm:pt-20 sm:pb-28 lg:grid-cols-[1fr_0.9fr] lg:gap-16 lg:px-12 lg:pt-24">
        <div className="relative z-10">
          <div className="border-primary/15 bg-primary/5 text-primary mb-7 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold tracking-wide">
            <Sparkles className="size-3.5" />
            {copy.productPill}
          </div>
          <h1 className="max-w-[700px] text-4xl leading-[1.08] font-semibold tracking-[-0.045em] text-balance sm:text-5xl lg:text-[4.25rem]">
            {copy.landingTitle}
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
            {copy.landingDescription}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/workspace"
              className="bg-primary text-primary-foreground shadow-primary/15 hover:shadow-primary/20 inline-flex h-12 items-center gap-2.5 rounded-xl px-5 text-sm font-semibold shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              {copy.enterWorkspace}
              <ArrowUpRight className="size-4" />
            </Link>
            <span className="text-muted-foreground text-sm">
              {copy.landingStartNote}
            </span>
          </div>
          <div className="border-border/70 text-muted-foreground mt-12 flex items-center gap-3 border-t pt-6 text-xs">
            <span className="grid size-7 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-500" />
            </span>
            {copy.landingOwnershipNote}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[590px]">
          <div className="bg-primary/10 absolute -inset-8 rounded-[3rem] blur-3xl" />
          <div className="bg-card relative overflow-hidden rounded-[1.75rem] border border-white/70 shadow-[0_32px_100px_-45px_rgba(32,55,110,0.36)] dark:border-white/10 dark:shadow-black/30">
            <div className="border-border/70 flex items-center justify-between border-b px-5 py-4">
              <div className="flex items-center gap-3">
                <BrandMark className="size-8 rounded-[10px]" />
                <div>
                  <PublicProductBrandName
                    locale={locale}
                    className="max-w-[11rem] truncate text-sm font-semibold"
                  />
                  <div className="text-muted-foreground mt-0.5 text-[11px]">
                    {copy.previewWorkspace}
                  </div>
                </div>
              </div>
              <span className="border-border/70 text-muted-foreground rounded-lg border px-2.5 py-1 text-[10px]">
                {copy.previewBadge}
              </span>
            </div>
            <div className="from-primary/[0.07] via-card to-card space-y-7 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] px-5 py-6 sm:px-7 sm:py-8">
              <div className="max-w-sm">
                <div className="text-primary text-xs font-medium">
                  {copy.previewQuestionEyebrow}
                </div>
                <div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                  {copy.previewQuestionTitle}
                </div>
              </div>
              <div className="border-border/80 bg-background/85 rounded-2xl border p-4 shadow-sm sm:p-5">
                <div className="text-muted-foreground flex items-start gap-3 text-sm leading-6">
                  <span className="bg-primary/10 text-primary mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg">
                    <Search className="size-3.5" />
                  </span>
                  <span>{copy.previewQuestion}</span>
                </div>
                <div className="border-border/70 mt-5 flex items-center justify-between border-t pt-4">
                  <span className="text-muted-foreground text-[11px]">
                    {copy.previewInputHint}
                  </span>
                  <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-xl">
                    <ArrowUpRight className="size-4" />
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PreviewTile
                  icon={<FileText className="size-4" />}
                  title={copy.create}
                  detail={copy.previewCreateDetail}
                />
                <PreviewTile
                  icon={<Layers3 className="size-4" />}
                  title={copy.organize}
                  detail={copy.previewOrganizeDetail}
                />
              </div>
            </div>
            <div className="border-border/70 text-muted-foreground border-t px-5 py-3 text-[10px]">
              {copy.previewFooter}
            </div>
          </div>
          <div className="border-border/70 bg-card/95 absolute -bottom-6 -left-6 hidden items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur sm:flex">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="size-4" />
            </span>
            <div>
              <div className="text-xs font-semibold">
                {copy.previewFloatingTitle}
              </div>
              <div className="text-muted-foreground mt-1 text-[10px]">
                {copy.previewFloatingDescription}
              </div>
            </div>
            <ArrowDownRight className="text-muted-foreground ml-2 size-4" />
          </div>
        </div>
      </section>

      <section className="border-border/70 bg-muted/35 border-y">
        <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
          <div className="max-w-xl">
            <div className="text-primary text-xs font-semibold tracking-[0.17em] uppercase">
              {copy.capabilitiesEyebrow}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              {copy.capabilities}
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<Search className="size-5" />}
              title={copy.research}
              description={copy.researchDescription}
              index="01"
            />
            <FeatureCard
              icon={<FileText className="size-5" />}
              title={copy.create}
              description={copy.createDescription}
              index="02"
            />
            <FeatureCard
              icon={<Layers3 className="size-5" />}
              title={copy.organize}
              description={copy.organizeDescription}
              index="03"
            />
          </div>
        </div>
      </section>

      <footer className="text-muted-foreground mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-7 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <PublicProductBrandName
          locale={locale}
          className="text-foreground/70 max-w-full truncate font-medium"
        />
        <a
          href={productBrand.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          {copy.poweredBy}
        </a>
      </footer>
    </main>
  );
}

function PreviewTile({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="border-border/70 bg-card/80 rounded-xl border p-3.5">
      <span className="bg-muted text-foreground/75 grid size-8 place-items-center rounded-lg">
        {icon}
      </span>
      <div className="mt-3 text-xs font-semibold">{title}</div>
      <div className="text-muted-foreground mt-1 text-[10px] leading-4">
        {detail}
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  index,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  index: string;
}) {
  return (
    <article className="group border-border/70 bg-card hover:border-primary/25 hover:shadow-primary/5 rounded-2xl border p-6 transition duration-200 hover:-translate-y-1 hover:shadow-lg sm:p-7">
      <div className="flex items-center justify-between">
        <span className="bg-primary/8 text-primary grid size-10 place-items-center rounded-xl">
          {icon}
        </span>
        <span className="text-muted-foreground/65 font-mono text-xs">
          {index}
        </span>
      </div>
      <h3 className="mt-7 text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        {description}
      </p>
      <div className="bg-primary/40 mt-6 h-px w-full origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100" />
    </article>
  );
}
