import { cn } from "@/lib/utils";

export function SettingsSection({
  className,
  title,
  description,
  children,
}: {
  className?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  // ?? 而非 ||：title/description 为 ReactNode，nullish 才视为缺省，
  // 与 JSX 渲染层对 0 等合法节点的处理保持一致。
  const hasHeader = Boolean(title ?? description);

  return (
    <section className={cn(className)}>
      {hasHeader && (
        <header className="space-y-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </header>
      )}
      {/* 每个设置分组都是普通内容区，页面只能有一个 main landmark。 */}
      <div className={cn(hasHeader && "mt-4")}>{children}</div>
    </section>
  );
}
