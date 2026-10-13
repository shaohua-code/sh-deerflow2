import { describe, expect, it } from "@rstest/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductLandingPage } from "@/product/landing-page";

describe("ProductLandingPage", () => {
  it("renders the Chinese product identity and keeps the upstream notice", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductLandingPage, { locale: "zh-CN" }),
    );

    expect(markup).toMatch(/<h1[^>]*>理清每一步，做好每件事。<\/h1>/);
    expect(markup).toContain("智能工作台");
    expect(markup).toContain("进入工作空间");
    expect(markup).toContain("研究工作台");
    expect(markup).toContain("梳理这个行业的主要趋势");
    expect(markup).toContain("你的工作空间，由你管理");
    expect(markup).not.toContain("01 / 03");
    expect(markup).toContain('aria-label="切换为英文"');
    expect(markup).toContain("基于 DeerFlow 构建 · MIT 许可证");
    expect(markup).toContain('href="https://github.com/bytedance/deer-flow"');
  });

  it("renders English copy without replacing the product name with upstream branding", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductLandingPage, { locale: "en-US" }),
    );

    expect(markup).toMatch(
      /<h1[^>]*>Good work starts with a clear next step\.<\/h1>/,
    );
    expect(markup).toContain("Flow Desk");
    expect(markup).toContain("Research workspace");
    expect(markup).toContain("Map the major trends");
    expect(markup).toContain("Your workspace, managed by you");
    expect(markup).not.toContain("01 / 03");
    expect(markup).toContain('aria-label="Switch language to Chinese"');
    expect(markup).toContain("Built on DeerFlow · MIT License");
  });

  it("keeps the narrow-screen header focused on the brand and language control", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductLandingPage, { locale: "zh-CN" }),
    );

    // 窄屏导航只保留品牌和语言切换；首页主按钮仍提供进入工作空间的入口。
    expect(markup).toMatch(
      /class="[^"]*hidden[^"]*sm:inline-flex[^"]*" href="\/workspace"/,
    );
    expect(markup).toMatch(/class="[^"]*h-12[^"]*" href="\/workspace"/);
    expect(markup).toContain("理清每一步，做好每件事。");
  });
});
