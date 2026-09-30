export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return "just now";
  const format = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
    style: "short",
  });
  if (abs < 3600) return format.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86_400)
    return format.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 604_800)
    return format.format(Math.round(diffSeconds / 86_400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone, timeZoneName: "short" } : {}),
  }).format(new Date(iso));
}

export function initials(
  name: string | null | undefined,
  fallback: string,
): string {
  const source = (name ?? "").trim() || fallback;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

export function humanize(code: string): string {
  const text = code.replace(/[_.]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
