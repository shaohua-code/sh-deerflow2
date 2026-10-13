import { GitHubLogoIcon } from "@radix-ui/react-icons";
import Link from "next/link";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, type Locale } from "@/core/i18n/locale";
import { getI18n } from "@/core/i18n/server";
import { cn } from "@/lib/utils";
import { getBrandName, productBrand } from "@/product/brand";
import { getProductCopy } from "@/product/copy";

import { MobileNav } from "./mobile-nav";

export type HeaderProps = {
  className?: string;
  homeURL?: string;
  locale?: Locale;
};

export async function Header({ className, homeURL, locale }: HeaderProps) {
  const { locale: resolvedLocale, t } = await getI18n(locale ?? DEFAULT_LOCALE);
  const lang = resolvedLocale.substring(0, 2);
  const homeHref = homeURL ?? "/";
  const isExternalHome = /^https?:\/\//.test(homeHref);
  const productCopy = getProductCopy(resolvedLocale);
  return (
    <header
      className={cn(
        "container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between gap-3 px-4 backdrop-blur-xs",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-6">
        {isExternalHome ? (
          <a
            href={homeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif text-xl whitespace-nowrap"
          >
            {getBrandName(resolvedLocale)}
          </a>
        ) : (
          <Link
            href={homeHref}
            className="font-serif text-xl whitespace-nowrap"
          >
            {getBrandName(resolvedLocale)}
          </Link>
        )}
      </div>
      <nav className="ml-auto hidden items-center gap-5 text-sm font-medium sm:flex md:mr-8 md:gap-8">
        <Link
          href={`/${lang}/docs`}
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          {t.home.docs}
        </Link>
        <Link
          href="/blog/posts"
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          {t.home.blog}
        </Link>
      </nav>
      <div className="hidden sm:block">
        <LocaleSwitcher locale={resolvedLocale} />
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 z-0 h-full w-full rounded-full opacity-30 blur-2xl"
          style={{
            background: "linear-gradient(90deg, #ff80b5 0%, #9089fc 100%)",
            filter: "blur(16px)",
          }}
        />
        <Button
          variant="outline"
          size="sm"
          asChild
          className="group relative z-10"
        >
          {/* 明确标注为上游引擎来源，避免访客把官方仓库误认为 Flow Desk 自己的仓库。 */}
          <a
            href={productBrand.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={productCopy.upstreamSource}
          >
            <GitHubLogoIcon className="size-4" />
            <span className="hidden sm:inline">
              {productCopy.upstreamSource}
            </span>
          </a>
        </Button>
      </div>
      <MobileNav
        locale={resolvedLocale}
        links={[
          { href: `/${lang}/docs`, label: t.home.docs },
          { href: "/blog/posts", label: t.home.blog },
        ]}
      />
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
