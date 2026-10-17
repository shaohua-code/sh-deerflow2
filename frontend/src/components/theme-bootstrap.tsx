import Script from "next/script";

export function ThemeBootstrap() {
  // 使用独立静态文件，避免把内联 script 作为 React 子节点参与服务端渲染和水合。
  // beforeInteractive 只挂在根布局，因此它会在首屏 hydration 前执行一次。
  // App Router 官方支持在根 layout 使用 beforeInteractive（规则提示针对
  // Pages Router 的 _document.js 限制，属误报）；主题闪烁防护依赖该时序。
  return (
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document -- App Router 根布局合法用法（规则针对 Pages Router），见上
    <Script
      id="flow-desk-theme-bootstrap"
      src="/theme-bootstrap.js"
      strategy="beforeInteractive"
    />
  );
}
