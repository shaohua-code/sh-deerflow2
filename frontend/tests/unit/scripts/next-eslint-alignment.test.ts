import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@rstest/core";

const frontendRoot = process.cwd();

function readLockedPackage(packageName: string) {
  const lockfile = readFileSync(
    resolve(frontendRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  const match = new RegExp(
    `^      ${packageName}:\\r?\\n        specifier: ([^\\r\\n]+)\\r?\\n        version: ([^\\r\\n]+)`,
    "m",
  ).exec(lockfile);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Missing importer lock entry for ${packageName}`);
  }
  const version = match[2].split("(")[0];
  if (!version) {
    throw new Error(`Missing resolved version for ${packageName}`);
  }
  return { specifier: match[1], version };
}

test("Next and its ESLint config stay on the same locked release", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(frontendRoot, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const next = readLockedPackage("next");
  const eslintConfigNext = readLockedPackage("eslint-config-next");

  // Next 升级时同步升级官方规则包，避免新 ESLint 配置与旧插件树混用。
  expect(manifest.devDependencies["eslint-config-next"]).toBe(
    manifest.dependencies.next,
  );
  expect(next.specifier).toBe(manifest.dependencies.next);
  expect(eslintConfigNext.specifier).toBe(
    manifest.devDependencies["eslint-config-next"],
  );
  expect(eslintConfigNext.version).toBe(next.version);
});

test("Next flat config uses the exported core-web-vitals subpath", () => {
  const config = readFileSync(
    resolve(frontendRoot, "eslint.config.js"),
    "utf8",
  );

  // eslint-config-next 16 的 exports 只定义不带后缀的子路径：带 .js 的
  // 导入会在 ESLint 9 启动时直接 ERR_PACKAGE_PATH_NOT_EXPORTED（P349 实
  // 测），因此约定必须使用无后缀形式。
  expect(config).toContain('from "eslint-config-next/core-web-vitals"');
});
