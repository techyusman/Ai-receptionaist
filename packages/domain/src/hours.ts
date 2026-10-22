// Opening hours in the location's own time zone (spec FR-KNOW-001). Times are local wall-clock
// "HH:MM"; a shift whose closing time is at or before its opening time runs past midnight.

export type Shift = { weekday: number; opens: string; closes: string };
export type SpecialDay = { date: string; closed: boolean; opens?: string | null; closes?: string | null };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function toMinutes(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Not a 24-hour time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export type LocalClock = { date: string; weekday: number; minutes: number };

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock date, weekday and minute-of-day at `at` in `timeZone`. Handles DST via Intl. */
export function localClock(at: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: weekdayIndex[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

type Window = { opens: number; closes: number };

/** The windows that start on `date`: its special day if one exists, otherwise its weekly shifts. */
export function windowsFor(date: string, shifts: Shift[], specials: SpecialDay[]): Window[] {
  const special = specials.filter((s) => s.date === date);
  if (special.length > 0) {
    if (special.some((s) => s.closed)) return [];
    return special
      .filter((s) => s.opens && s.closes)
      .map((s) => ({ opens: toMinutes(s.opens as string), closes: toMinutes(s.closes as string) }));
  }
  const wd = weekdayOf(date);
  return shifts.filter((s) => s.weekday === wd).map((s) => ({ opens: toMinutes(s.opens), closes: toMinutes(s.closes) }));
}

export function isOpenAt(shifts: Shift[], specials: SpecialDay[], at: Date, timeZone: string): boolean {
  const now = localClock(at, timeZone);
  for (const w of windowsFor(now.date, shifts, specials)) {
    const end = w.closes > w.opens ? w.closes : 24 * 60;
    if (now.minutes >= w.opens && now.minutes < end) return true;
  }
  // Yesterday's shifts that run past midnight.
  for (const w of windowsFor(addDays(now.date, -1), shifts, specials)) {
    if (w.closes <= w.opens && now.minutes < w.closes) return true;
  }
  return false;
}

export type Overlap = { weekday: number; message: string };

/** Overlapping shifts in a weekly schedule, including overnight shifts spilling into the next day. */
export function findOverlaps(shifts: Shift[]): Overlap[] {
  const WEEK = 7 * 24 * 60;
  const spans = shifts.map((s) => {
    const start = s.weekday * 1440 + toMinutes(s.opens);
    let end = s.weekday * 1440 + toMinutes(s.closes);
    if (end <= start) end += 1440;
    return { s, start, end };
  });
  const out: Overlap[] = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      // Compare on the circular week: shift b by ±1 week to catch Saturday-night → Sunday spills.
      const hit = [-WEEK, 0, WEEK].some((k) => a.start < b.end + k && b.start + k < a.end);
      if (hit) {
        out.push({
          weekday: a.s.weekday,
          message: `${WEEKDAYS[a.s.weekday]} ${a.s.opens}–${a.s.closes} overlaps ${WEEKDAYS[b.s.weekday]} ${b.s.opens}–${b.s.closes}.`,
        });
      }
    }
  }
  return out;
}

/** "11:00–14:00, 17:00–22:00" or "Closed" for a date, for the AI and the dashboard. */
export function describeDay(date: string, shifts: Shift[], specials: SpecialDay[]): string {
  const ws = windowsFor(date, shifts, specials);
  if (ws.length === 0) return "Closed";
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return ws
    .sort((a, b) => a.opens - b.opens)
    .map((w) => `${fmt(w.opens)}–${fmt(w.closes)}`)
    .join(", ");
}
