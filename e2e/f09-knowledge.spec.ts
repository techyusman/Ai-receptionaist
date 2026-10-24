// F09 Answers the AI gives (FAQs): add with an end date, edit in place, delete; duplicates, starter
// drafts, the length limit, accents and emoji.
import type { Page } from "@playwright/test";
import { axe, expect, PEOPLE, signIn, test, unique } from "./fixtures";

async function addAnswer(page: Page, question: string, answer: string, until?: string) {
  await page.getByRole("button", { name: "Add an answer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an answer" });
  await dialog.getByLabel("Question").fill(question);
  await dialog.getByLabel("Answer", { exact: true }).fill(answer);
  if (until) await dialog.getByLabel("Use until").fill(until);
  await dialog.getByRole("button", { name: "Save" }).click();
  return dialog;
}

const item = (page: Page, question: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: question, exact: true }) });

test("F09-H1 add an answer that ends on a date, edit it in place, delete it", async ({ page }) => {
  const q = `${unique("Is the patio open")}?`;
  await signIn(page, PEOPLE.manager);
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  const dialog = await addAnswer(page, q, "Yes, from 8 until 4 when it isn't raining.", "2026-11-30");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved. The AI uses it on the next call.", { exact: true }).first()).toBeVisible();
  await expect(item(page, q)).toContainText("Until Mon, Nov 30");

  await page.getByRole("button", { name: `Edit “${q}”` }).click();
  const edit = page.getByRole("dialog", { name: "Edit answer" });
  await edit.getByLabel("Answer", { exact: true }).fill("Yes, from 8 until 5 now that it's warmer.");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(item(page, q)).toHaveCount(1);
  await expect(item(page, q)).toContainText("until 5 now");

  await page.getByRole("button", { name: `Delete “${q}”` }).click();
  await page.getByRole("dialog", { name: "Delete this answer?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Answer deleted", { exact: true }).first()).toBeVisible();
  await expect(item(page, q)).toHaveCount(0);
});

test("F09-E1 the same question again, in other case and punctuation, is refused", async ({ page }) => {
  const q = unique("Do you have a patio heater");
  await signIn(page, PEOPLE.manager);
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  await expect(await addAnswer(page, `${q}?`, "Two, by the door.")).toBeHidden();
  const again = await addAnswer(page, `${q.toUpperCase()}!!`, "Yes.");
  await expect(again.getByText("You already have this question. Edit that one instead, so the AI has one answer.")).toBeVisible();
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(item(page, `${q}?`)).toHaveCount(1);
});

test("F09-E2 starter drafts can't be saved until the [brackets] are replaced", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add starter questions" }).click();
  await expect(page.getByText(/^Added \d+ starter questions as drafts$/).first()).toBeVisible();
  const q = "Is there step-free access?";
  await expect(item(page, q)).toContainText("Draft");
  await page.getByRole("button", { name: `Edit “${q}”` }).click();
  const edit = page.getByRole("dialog", { name: "Edit answer" });
  await expect(edit.getByText("Replace the parts in [brackets] with your details.")).toBeVisible();
  await expect(edit.getByRole("button", { name: "Save" })).toBeDisabled();
  await edit.getByLabel("Answer", { exact: true }).fill("Yes: the side door on Main Street has a ramp, and the counter is low.");
  await expect(edit.getByRole("button", { name: "Save" })).toBeEnabled();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(item(page, q)).not.toContainText("Draft");
});

test("F09-E3/E4 the 2,000-character limit, and accents and emoji kept exactly", async ({ page }) => {
  const q = `¿Hay café descafeinado? ☕ ${Date.now() % 100000}`;
  const answer = "Sí, todo el día — también con leche de avena 🌾. Ça marche!";
  await signIn(page, PEOPLE.manager);
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add an answer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an answer" });
  const field = dialog.getByLabel("Answer", { exact: true });
  await field.fill("a".repeat(1990));
  await expect(dialog.getByText("1990 / 2000")).toBeVisible();
  await field.fill("a".repeat(2001));
  expect((await field.inputValue()).length).toBeLessThanOrEqual(2000);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(await addAnswer(page, q, answer)).toBeHidden();
  await expect(item(page, q)).toContainText(answer);
  await page.reload({ waitUntil: "networkidle" });
  await expect(item(page, q)).toContainText(answer);
});
