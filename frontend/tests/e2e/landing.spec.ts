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
});
