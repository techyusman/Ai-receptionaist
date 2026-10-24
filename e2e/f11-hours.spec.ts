// F11 Opening hours: an extra shift, overlaps, holidays and a day the clocks change.
import type { Page } from "@playwright/test";
import { axe, expect, PEOPLE, signIn, test } from "./fixtures";

const specialRows = (page: Page) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Remove (Mon|Tue|Wed|Thu|Fri|Sat|Sun), / }) });

async function addSpecialDay(page: Page, date: string, opts: { opens?: string; closes?: string; note?: string } = {}) {
  await page.getByLabel("Date", { exact: true }).fill(date);
  const closed = page.getByRole("switch", { name: /^Closed all day/ });
  if ((await closed.getAttribute("aria-checked")) !== String(!opts.opens)) await closed.click();
  if (opts.opens) {
    await page.getByLabel("Opens", { exact: true }).fill(opts.opens);
    await page.getByLabel("Closes", { exact: true }).fill(opts.closes!);
  }
  if (opts.note) await page.getByLabel("Note (optional)").fill(opts.note);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

test("F11-H1/E1 an evening shift on Monday saves; an overlapping one is flagged and can't be saved", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/location", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Add a shift" }).first().click();
  await page.getByLabel("Monday shift 2 opens").fill("19:00");
  await page.getByLabel("Monday shift 2 closes").fill("22:00");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved", { exact: true }).first()).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Monday shift 2 closes")).toHaveValue("22:00");

  await page.getByLabel("Monday shift 2 opens").fill("17:00");
  await expect(page.getByRole("alert").filter({ hasText: "Monday 07:00–18:00 overlaps Monday 17:00–22:00. Fix it to save." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save hours" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove Monday shift 2" }).click();
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved", { exact: true }).first()).toBeVisible();
});

test("F11-E4 clearing a time while editing doesn't break the screen", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/location", { waitUntil: "networkidle" });
  await page.getByLabel("Monday shift 1 opens").fill("");
  await expect(page.getByText("This screen didn't load")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Weekly hours" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Monday needs an opening and a closing time. Fix it to save." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save hours" })).toBeDisabled();
});

test("F11-E2/E3 a holiday closure, and special hours on the day the clocks change", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/location", { waitUntil: "networkidle" });
  await addSpecialDay(page, "2026-12-31", { note: "New Year's Eve" });
  await expect(page.getByText("Special day added", { exact: true }).first()).toBeVisible();
  await expect(specialRows(page).filter({ hasText: "Thu, Dec 31, 2026: Closed · New Year's Eve" })).toHaveCount(1);
  // 14 March 2027: clocks in New York jump from 02:00 to 03:00. Times are kept as the restaurant's local times.
  await addSpecialDay(page, "2027-03-14", { opens: "01:00", closes: "04:00", note: "Clocks change" });
  await expect(specialRows(page).filter({ hasText: "Sun, Mar 14, 2027: 01:00–04:00 · Clocks change" })).toHaveCount(1);
  await addSpecialDay(page, "2026-12-31", { note: "Again" });
  await expect(page.getByText("That day is already marked closed.").first()).toBeVisible();
  // BUG-012: hours on a day that's closed would be listed but never used (a closure wins on the phone).
  await addSpecialDay(page, "2026-12-31", { opens: "10:00", closes: "14:00", note: "Brunch" });
  await expect(page.getByText("That day is marked closed. Remove the closure first to add hours.")).toBeVisible();
  await expect(specialRows(page).filter({ hasText: "Thu, Dec 31, 2026" })).toHaveCount(1);
});

test("F11-E5 a special day that opens and closes at the same time says why it wasn't added", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/location", { waitUntil: "networkidle" });
  await addSpecialDay(page, "2027-01-05", { opens: "09:00", closes: "09:00" });
  await expect(page.getByText("Add opening and closing times, or mark the day closed.").first()).toBeVisible();
  await expect(specialRows(page).filter({ hasText: "Tue, Jan 5, 2027" })).toHaveCount(0);
});
