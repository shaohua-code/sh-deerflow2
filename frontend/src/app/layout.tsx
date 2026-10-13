import "@/styles/globals.css";

import { type Metadata } from "next";
import Script from "next/script";

import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_LOCALE } from "@/core/i18n/locale";
import { getBrandDescription, getBrandName } from "@/product/brand";
import {
  PublicProductBrandDocumentTitle,
  PublicProductBrandProvider,
} from "@/product/public-brand";

export const metadata: Metadata = {
  // Next.js 会用这份 metadata 设置文档标题；产品名统一从 brand.ts 读取。
  title: getBrandName(DEFAULT_LOCALE),
  description: getBrandDescription(DEFAULT_LOCALE),
};

// This inline bootstrap is rendered by the Server Component root layout and
// runs before hydration, so the page does not flash the wrong theme. Keeping it
// here also avoids a <script> rendered by the client-side ThemeProvider.
const THEME_BOOTSTRAP = `(() => {
  const root = document.documentElement;
  let theme = "system";
  try {
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "light" || storedTheme === "dark") theme = storedTheme;
  } catch {}
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const forcedTheme = window.location.pathname === "/" ? "dark" : undefined;
  const resolvedTheme = forcedTheme || (theme === "system" ? systemTheme : theme);
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressContentEditableWarning
      suppressHydrationWarning
    >
      <body>
        <Script id="flow-desk-theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        <ThemeProvider disableTransitionOnChange>
          <PublicProductBrandProvider>
            <PublicProductBrandDocumentTitle />
            {children}
          </PublicProductBrandProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
