import Script from "next/script";

export function ThemeBootstrap() {
  // 使用独立静态文件，避免把内联 script 作为 React 子节点参与服务端渲染和水合。
  // beforeInteractive 只挂在根布局，因此它会在首屏 hydration 前执行一次。
  return (
    <Script
      id="flow-desk-theme-bootstrap"
      src="/theme-bootstrap.js"
      strategy="beforeInteractive"
    />
  );
}
