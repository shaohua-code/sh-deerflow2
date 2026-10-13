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
  const hasHeader = Boolean(title || description);

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
