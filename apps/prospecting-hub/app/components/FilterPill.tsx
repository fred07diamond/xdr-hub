// Ported from apps/li-agent/app/routes/_index.tsx's FilterPill (itself
// duplicated there between two files) so both apps' filter rows share one
// visual/interaction recipe instead of drifting further apart.
export function FilterPill({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active && color ? { background: color + "22", borderColor: color, color } : {}}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active && !color
          ? "border-foreground/30 bg-foreground/10 text-foreground"
          : !active
            ? "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            : ""
      }`}
    >
      {children}
    </button>
  );
}
