import assert from "node:assert/strict";
import { test } from "node:test";
import { describeDay, findOverlaps, isOpenAt, localClock, zonedTimeToUtc, type Shift } from "./hours.ts";
import { formatMoney, maskPhone, prettyPhone, taxOn } from "./money.ts";

const NY = "America/New_York";
// Mon–Fri 07:00–15:00, Fri late shift 18:00–01:00, Sat 08:00–16:00. Sunday closed.
const week: Shift[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:00", closes: "15:00" })),
  { weekday: 5, opens: "18:00", closes: "01:00" },
  { weekday: 6, opens: "08:00", closes: "16:00" },
];

test("local clock follows the location's zone, including DST", () => {
  // 2026-11-01 is the US fall-back day: 05:30Z is 01:30 EDT, 06:30Z is 01:30 EST.
  assert.deepEqual(localClock(new Date("2026-11-01T05:30:00Z"), NY), { date: "2026-11-01", weekday: 0, minutes: 90 });
  assert.deepEqual(localClock(new Date("2026-11-01T06:30:00Z"), NY), { date: "2026-11-01", weekday: 0, minutes: 90 });
  assert.equal(localClock(new Date("2026-10-22T03:00:00Z"), NY).date, "2026-10-21");
});

test("open and closed by weekday, in local time", () => {
  assert.equal(isOpenAt(week, [], new Date("2026-10-22T12:00:00Z"), NY), true); // Thu 08:00
  assert.equal(isOpenAt(week, [], new Date("2026-10-22T20:00:00Z"), NY), false); // Thu 16:00
  assert.equal(isOpenAt(week, [], new Date("2026-10-25T16:00:00Z"), NY), false); // Sun noon
});

test("a shift past midnight is open after midnight on the next day", () => {
  assert.equal(isOpenAt(week, [], new Date("2026-10-24T04:30:00Z"), NY), true); // Sat 00:30
  assert.equal(isOpenAt(week, [], new Date("2026-10-24T05:30:00Z"), NY), false); // Sat 01:30
});

test("special days override the weekly schedule", () => {
  const closedThu = [{ date: "2026-10-22", closed: true }];
  assert.equal(isOpenAt(week, closedThu, new Date("2026-10-22T12:00:00Z"), NY), false);
  const lateSun = [{ date: "2026-10-25", closed: false, opens: "10:00", closes: "14:00" }];
  assert.equal(isOpenAt(week, lateSun, new Date("2026-10-25T15:00:00Z"), NY), true);
  assert.equal(describeDay("2026-10-25", week, lateSun), "10:00–14:00");
  assert.equal(describeDay("2026-10-25", week, []), "Closed");
  assert.equal(describeDay("2026-10-23", week, []), "07:00–15:00, 18:00–01:00");
});

test("overlapping shifts are found, including overnight spills", () => {
  assert.deepEqual(findOverlaps(week), []);
  assert.equal(findOverlaps([...week, { weekday: 3, opens: "14:00", closes: "18:00" }]).length, 1);
  // Friday's 18:00–01:00 spills into Saturday; a Saturday 00:00 start overlaps it.
  assert.equal(findOverlaps([...week, { weekday: 6, opens: "00:00", closes: "02:00" }]).length, 1);
  // Saturday night into Sunday wraps the week.
  assert.equal(findOverlaps([{ weekday: 6, opens: "22:00", closes: "02:00" }, { weekday: 0, opens: "01:00", closes: "03:00" }]).length, 1);
});

test("local wall-clock times convert to UTC across DST", () => {
  assert.equal(zonedTimeToUtc("2026-11-30", "23:59", NY).toISOString(), "2026-12-01T04:59:00.000Z"); // EST, UTC-5
  assert.equal(zonedTimeToUtc("2026-07-04", "09:00", NY).toISOString(), "2026-07-04T13:00:00.000Z"); // EDT, UTC-4
  assert.equal(zonedTimeToUtc("2026-03-08", "02:30", NY).toISOString(), "2026-03-08T07:30:00.000Z"); // in the spring gap: 03:30 EDT
  assert.equal(zonedTimeToUtc("2026-10-22", "12:00", "Asia/Kolkata").toISOString(), "2026-10-22T06:30:00.000Z");
  assert.equal(zonedTimeToUtc("2026-11-01", "01:30", NY).toISOString(), "2026-11-01T05:30:00.000Z"); // fall-back overlap: first pass (EDT)
});

test("money and phone helpers", () => {
  assert.equal(formatMoney(1840, "USD"), "$18.40");
  assert.equal(formatMoney(500, "JPY"), "¥500");
  assert.equal(taxOn(1000, 8.875), 89); // 88.75 rounds half up
  assert.equal(taxOn(400, 8.875), 36); // 35.5 rounds up
  assert.equal(prettyPhone("+15550123456"), "+1 555 012 3456");
  assert.equal(maskPhone("+15550123456"), "••• 3456");
  assert.equal(maskPhone(null), "Unknown caller");
});
