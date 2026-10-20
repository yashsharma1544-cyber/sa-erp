import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  footer,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "brand" | "muted";
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-5 shadow-card",
        tone === "brand" && "border-brand-800 bg-brand-800 text-white",
        tone === "neutral" && "border-slate-200 bg-white",
        tone === "muted" && "border-dashed border-slate-300 bg-white/60",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("text-sm font-medium", tone === "brand" ? "text-brand-100" : "text-slate-500")}>{label}</span>
        {icon && (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              tone === "brand" ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className={cn("num mt-3 text-3xl font-semibold tracking-tight", tone === "muted" && "text-slate-400")}>
        {value}
      </div>
      {sub && <div className={cn("mt-1 text-sm", tone === "brand" ? "text-brand-100" : "text-slate-500")}>{sub}</div>}
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}
