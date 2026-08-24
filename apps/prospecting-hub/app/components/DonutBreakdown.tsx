import { IconChartBar } from "@tabler/icons-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// Extracted from app/routes/analytics.tsx so app/routes/pull-plans.tsx's
// composition-mix live preview can reuse the exact same donut recipe
// (Phase 3's chart component library) instead of duplicating it -- the
// pairing of "sliders set the mix, this donut visualizes it as a literal
// circular gauge" is what answers the original "use a gauge" ask.

export function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export function EmptyState({
  icon: Icon,
  text,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-border text-center ${compact ? "py-6" : "py-10"}`}>
      <Icon className="size-7 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function DonutBreakdown({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const visible = segments.filter((s) => s.value > 0);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <EmptyState icon={IconChartBar} text="No data yet." compact />;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={visible} dataKey="value" nameKey="label" innerRadius={42} outerRadius={64} paddingAngle={2} strokeWidth={0}>
              {visible.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{total.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{s.value.toLocaleString()}</span>
            <span className="w-9 text-right text-muted-foreground">{pct(s.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
