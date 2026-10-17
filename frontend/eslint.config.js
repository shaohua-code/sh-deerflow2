// eslint-config-next 16 的 exports 只提供不带 .js 后缀的子路径。
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next",
      ".next-codex-*/**",
      ".next-flowdesk-ui-*/**",
      "playwright-report",
      "test-results",
      "src/components/ui/**",
      "src/components/ai-elements/**",
      "*.js",
    ],
  },
  // Next.js 16 的官方配置原生支持 Flat Config，直接组合可避免 legacy patch。
  ...nextVitals,
  {
    // eslint-plugin-react-hooks 7（经 eslint-config-next 16 引入）新增 React
    // Compiler 语义规则。仓库既有消息顺序/去重/草稿恢复逻辑大量采用带注释的
    // 渲染期缓存 ref 与 effect 内同步 setState 模式，一轮内重构风险过高。将四条
    // 新规则降级为 warn：规则仍全量运行并输出全部位置（当前约 140 处）作为技术
    // 债清单，后续轮次逐模块清零；经典规则 rules-of-hooks 与 exhaustive-deps
    // 保持 error 不变。
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "import/order": [
        "error",
        {
          distinctGroup: false,
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
          ],
          pathGroups: [
            {
              pattern: "@/**",
              group: "internal",
            },
            {
              pattern: "./**.css",
              group: "object",
            },
            {
              pattern: "**.md",
              group: "object",
            },
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    // 测试专用豁免：typescript-eslint 的类型 program 对 @testing-library
    // 查询器（getByRole/getByLabelText）返回类型存在系统性误判——删除
    // `as HTMLInputElement`/`as HTMLButtonElement` 断言后 tsc --noEmit 报
    // TS2339（HTMLElement 无 value/disabled），恢复断言后 tsc exit 0，证明
    // 断言必要而规则结论错误。以 tsc 为准，仅在 tests/** 关闭该规则；
    // src/ 源码仍保持 error。
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);
