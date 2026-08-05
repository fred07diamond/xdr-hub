export { cn } from "@agent-native/toolkit/utils";

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's LOCAL time.
// Slicing a UTC ISO string instead shows UTC digits as if they were local,
// shifting the displayed (and, if saved unconverted, booked) time by the
// viewer's UTC offset.
export function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Converts a "YYYY-MM-DDTHH:mm" datetime-local value — interpreted by the
// browser as local time — back to an absolute UTC instant.
export function localDatetimeValueToISO(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
