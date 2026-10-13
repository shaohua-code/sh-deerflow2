import { afterEach, expect, test, rs } from "@rstest/core";

const original = process.env.NEXT_PUBLIC_APP_VERSION;

afterEach(() => {
  rs.resetModules();
  if (original === undefined) {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  } else {
    process.env.NEXT_PUBLIC_APP_VERSION = original;
  }
});

test("English About copy uses the product identity and app version", async () => {
  process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9-test";
  const { getAboutMarkdown } =
    await import("@/components/workspace/settings/about-content");
  const aboutMarkdown = getAboutMarkdown("en-US");
  expect(aboutMarkdown).toContain("# About Flow Desk 9.9.9-test");
  expect(aboutMarkdown).toContain("Open-source foundation");
  expect(aboutMarkdown).toContain("MIT License");
});

test("Chinese About copy keeps product version, attribution, and license", async () => {
  process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9-test";
  const { getAboutMarkdown } =
    await import("@/components/workspace/settings/about-content");
  const aboutMarkdown = getAboutMarkdown("zh-CN");

  expect(aboutMarkdown).toContain("# 关于 智能工作台 9.9.9-test");
  expect(aboutMarkdown).toContain("开源基础");
  expect(aboutMarkdown).toContain("MIT 许可证");
  expect(aboutMarkdown).toContain("https://github.com/bytedance/deer-flow");
});

test("About copy reflects the package version when env is unset", async () => {
  delete process.env.NEXT_PUBLIC_APP_VERSION;
  const { APP_VERSION } = await import("@/version");
  const { getAboutMarkdown } =
    await import("@/components/workspace/settings/about-content");
  // The product heading carries the resolved version, not an empty or undefined value.
  expect(getAboutMarkdown("en-US")).toContain(
    `# About Flow Desk ${APP_VERSION}`,
  );
});
