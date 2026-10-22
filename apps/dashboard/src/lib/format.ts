// Display formatting. Times always render in the restaurant's time zone (never the server's or the
// browser's), and are formatted on the server so the HTML and hydration agree.

export { formatMoney, maskPhone, prettyPhone } from "@receptionist/domain";

const locale = "en-US";

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

export function fmtDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "In progress";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function itemsSummary(lines: { quantity: number; itemName: string }[]): string {
  if (lines.length === 0) return "No items";
  const first = lines.slice(0, 2).map((l) => `${l.quantity} × ${l.itemName}`).join(", ");
  return lines.length > 2 ? `${first} +${lines.length - 2} more` : first;
}
