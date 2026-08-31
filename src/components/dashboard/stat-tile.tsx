import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-xs",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {Icon ? <Icon className="size-4 text-muted-foreground/70" /> : null}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
