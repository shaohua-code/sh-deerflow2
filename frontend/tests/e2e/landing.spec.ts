import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

test.describe("Landing page", () => {
  test("renders the header and hero section", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("link", { name: "Flow Desk", exact: true }),
    ).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText(
      "Good work starts with a clear next step.",
    );

    // 主 CTA 使用 Flow Desk 的产品文案。
    await expect(
      page
        .getByRole("link", { name: "Open your workspace", exact: true })
        .last(),
    ).toBeVisible();
  });

  for (const width of [320, 375, 390]) {
    test(`does not overflow at ${width}px width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/");

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await expect(page.locator("main").first()).toBeInViewport();
    });
  }

  test("keeps the product name visible in the compact mobile header", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const header = page.locator("header");
    await expect(
      header.getByRole("link", { name: "Flow Desk", exact: true }),
    ).toBeVisible();
    await expect(
      header.getByRole("link", {
        name: "Open your workspace",
        exact: true,
      }),
    ).toBeHidden();
    await expect(
      page
        .getByRole("link", { name: "Open your workspace", exact: true })
        .last(),
    ).toBeVisible();
  });

  test("Open your workspace link navigates to workspace", async ({ page }) => {
    mockLangGraphAPI(page);

    await page.goto("/");

    await page
      .getByRole("link", { name: "Open your workspace", exact: true })
      .last()
      .click();

    await page.waitForURL("**/workspace");
    await expect(page).toHaveURL(/\/workspace$/);
  });

  // 产品默认语言是中文：清掉全局注入的 en-US Cookie 后，无 Cookie 的服务端
  // 渲染必须回退中文（DEFAULT_LOCALE，见 core/i18n/locale.ts）。
  test("renders Chinese default copy without a locale cookie", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/");

    await expect(
      page.getByRole("link", { name: "智能工作台", exact: true }),
    ).toBeVisible();
    await expect(page.locator("h1")).toContainText("理清每一步，做好每件事。");
    await expect(
      page.getByRole("link", { name: "进入工作空间", exact: true }).last(),
    ).toBeVisible();
  });
});
