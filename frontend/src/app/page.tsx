import { detectLocaleServer } from "@/core/i18n/server";
import { ProductLandingPage } from "@/product/landing-page";

// App Router 的 URL 入口保持稳定；品牌首页的具体实现放在产品目录，减少
// 同步上游 landing 组件时产生的冲突。
export default async function LandingPage() {
  const locale = await detectLocaleServer();
  return <ProductLandingPage locale={locale} />;
}
