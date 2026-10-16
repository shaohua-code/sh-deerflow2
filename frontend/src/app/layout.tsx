import "@/styles/globals.css";

import { type Metadata } from "next";

import { ThemeBootstrap } from "@/components/theme-bootstrap";
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
        <ThemeBootstrap />
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
