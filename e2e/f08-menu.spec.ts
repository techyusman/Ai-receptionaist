// F08 A menu change reaches the AI: hide an item, 86 one for today, add a spoken nickname, resync.
// The test call's search runs the same matching the AI uses on a real call.
import type { Page } from "@playwright/test";
import { axe, expect, PEOPLE, signIn, test } from "./fixtures";

async function aiFinds(page: Page, said: string) {
  await page.goto("/agent/test", { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: "Start a test call" });
  if (await start.isVisible()) {
    await start.click();
    await page.waitForURL(/order=/);
  }
  await page.getByLabel("What the caller said").fill(said);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText(/Menu matches|I can't find that/).first()).toBeVisible();
  return page.getByRole("button").filter({ hasText: /·|\$/ }).allInnerTexts();
}

async function openItem(page: Page, name: string) {
  await page.goto("/menu", { waitUntil: "networkidle" });
  await page.getByRole("table", { name: "Menu items" }).getByRole("link", { name, exact: true }).click();
  return page.getByRole("dialog", { name });
}

test("F08-H1 search the menu and open an item: sizes, prices and the choices the AI asks for", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/menu", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByRole("textbox", { name: "Search the menu" }).fill("latte");
  const table = page.getByRole("table", { name: "Menu items" });
  await expect(table.getByRole("link", { name: "Latte", exact: true })).toBeVisible();
  await expect(table.getByRole("link", { name: "Cold Brew", exact: true })).toHaveCount(0);
  await table.getByRole("link", { name: "Latte", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Latte" });
  await expect(drawer.getByText("The AI offers this by phone.")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Sizes and prices" })).toBeVisible();
  await expect(drawer).toContainText("$4.50");
  await expect(drawer).toContainText("$5.50");
  await expect(drawer.getByText(/^Milk \(required, pick 1\)/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("F08-H2 hide an item and 86 another: both drop out of the AI's menu, then come back", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  let drawer = await openItem(page, "Spiced Cider");
  await drawer.getByRole("switch", { name: /^Never offer this by phone/ }).click();
  await expect(page.getByText("Hidden from the AI", { exact: true }).first()).toBeVisible();
  drawer = await openItem(page, "Drip Coffee");
  await drawer.getByRole("switch", { name: /^Sold out for the rest of today/ }).click();
  await expect(page.getByText("Marked sold out for today", { exact: true }).first()).toBeVisible();

  await page.goto("/menu", { waitUntil: "networkidle" });
  await page.getByRole("checkbox", { name: "Only items the AI won't offer" }).check();
  const table = page.getByRole("table", { name: "Menu items" });
  await expect(table.getByRole("row").filter({ hasText: "Spiced Cider" })).toContainText("Hidden from the AI");
  await expect(table.getByRole("row").filter({ hasText: "Drip Coffee" })).toContainText(/Unavailable until/);

  expect(await aiFinds(page, "spiced cider")).not.toContainEqual(expect.stringContaining("Spiced Cider"));
  expect(await aiFinds(page, "drip coffee")).not.toContainEqual(expect.stringContaining("Drip Coffee"));

  drawer = await openItem(page, "Spiced Cider");
  await drawer.getByRole("switch", { name: /^Never offer this by phone/ }).click();
  await expect(page.getByText("The AI can offer it again", { exact: true }).first()).toBeVisible();
  drawer = await openItem(page, "Drip Coffee");
  await drawer.getByRole("switch", { name: /^Sold out for the rest of today/ }).click();
  await expect(page.getByText("Available again", { exact: true }).first()).toBeVisible();
  expect(await aiFinds(page, "spiced cider")).toContainEqual(expect.stringContaining("Spiced Cider"));
});

test("F08-H3/E1 a spoken nickname: the AI finds the item by it, and a clash is refused", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  const drawer = await openItem(page, "Almond Croissant");
  await drawer.getByRole("textbox", { name: "Add a nickname" }).fill("nut pastry");
  await drawer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Callers can now say “nut pastry”", { exact: true }).first()).toBeVisible();
  await drawer.getByRole("textbox", { name: "Add a nickname" }).fill("iced coffee");
  await drawer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(drawer.getByText("“iced coffee” already means Cold Brew.")).toBeVisible();
  const found = await aiFinds(page, "nut pastry");
  expect(found).toContainEqual(expect.stringContaining("Almond Croissant"));
  await expect(page.getByText("heard “nut pastry”")).toBeVisible();
});

test("F08-E2 Sync the menu from Square now: the status comes back to up to date", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await page.goto("/menu", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sync the menu from Square now" }).click();
  await expect(page.getByText("Syncing the menu now", { exact: true }).first()).toBeVisible();
  await expect(async () => {
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("Menu up to date", { exact: true }).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
});
