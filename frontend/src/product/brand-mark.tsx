import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shadow-primary/20 inline-grid size-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#6478F4,#3847B7)] text-white shadow-sm",
        className,
      )}
    >
      {/* 自有界面复用 favicon 的 F 与绿点图形，保证品牌标志在不同页面一致。 */}
      <svg viewBox="0 0 64 64" className="size-[68%]" fill="none">
        <path d="M19 16h27v7H27v7h16v7H27v11h-8V16Z" fill="currentColor" />
        <circle cx="47" cy="44" r="5" fill="#70E0BD" />
      </svg>
    </span>
  );
}
