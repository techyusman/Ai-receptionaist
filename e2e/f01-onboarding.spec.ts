// F01 Owner onboards a restaurant: sign up with a new email, create the restaurant, then work down the
// setup checklist (number, Square, hours, transfer number, where orders go, a test order).
import type { Page } from "@playwright/test";
import { apiAs, axe, expect, signIn, test } from "./fixtures";

test.describe.configure({ mode: "serial" });
const email = `owner${Date.now() % 100000}@newcafe.test`;
const NAME = "Café Ñandú 🥐";

async function stepDone(page: Page, title: string) {
  await page.goto("/setup");
  return (await page.getByRole("listitem").filter({ hasText: title }).first().innerText()).includes("Done");
}

test("F01-E1/E2/E3/E4 the welcome form: required name, length limit, accents and emoji, one restaurant on a double click", async ({ page }) => {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/welcome$/);
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Street address").fill("1 Test Street");
  await page.getByLabel("City").fill("Queens");
  await page.getByLabel("State").fill("NY");
  await page.getByLabel("ZIP code").fill("11101");
  await page.getByRole("button", { name: "Create restaurant" }).click();
  await expect(page, "an empty name doesn't submit (F01-E1)").toHaveURL(/\/welcome$/);
  await page.getByLabel("Restaurant name").fill("x".repeat(130));
  expect((await page.getByLabel("Restaurant name").inputValue()).length, "stops at 120 characters (F01-E2)").toBe(120);
  await page.getByLabel("Restaurant name").fill(NAME);
  await page.getByRole("button", { name: "Create restaurant" }).dblclick();
  await expect(page).toHaveURL(/\/setup$/);
  const me = await (await apiAs(email)).call<{ memberships: { restaurant: { name: string } }[] }>("GET", "/me");
  expect(me.memberships.map((m) => m.restaurant.name), "one restaurant, name exactly as typed (F01-E3, F01-E4)").toEqual([NAME]);
});

test("F01-H1 the checklist starts with nothing ticked, and /welcome now sends you home (F01-E5)", async ({ page }) => {
  await signIn(page, email);
  for (const t of ["Get an AI phone number", "Connect Square", "Set your opening hours", "Add a transfer number", "Place a test order"]) expect(await stepDone(page, t), t).toBe(false);
  await page.goto("/welcome");
  await expect(page).not.toHaveURL(/\/welcome/);
});

test("F01-H2 get an AI phone number (F01-E7: a short area code can't be searched)", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/agent/phone", { waitUntil: "networkidle" });
  await page.getByLabel("Area code").fill("71");
  await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();
  await page.getByLabel("Area code").fill("718");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("radio").first().waitFor();
  await page.getByRole("button", { name: "Add this number" }).click();
  await expect(page.getByText("Number added", { exact: true }).first()).toBeVisible();
  expect(await stepDone(page, "Get an AI phone number")).toBe(true);
});

test("F01-H3 connect Square through its sign-in page and pick a location", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/square", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect Square" }).click();
  await page.waitForURL(/\/square\?connected=1/);
  await expect(page.getByRole("main").getByText("Square is connected. Now pick the location the AI should use.")).toBeVisible();
  await page.getByRole("radio", { name: /Second Avenue/ }).click();
  await page.getByRole("button", { name: "Use this location" }).click();
  await expect(page.getByText(/Menu up to date|Synced/).first()).toBeVisible({ timeout: 20_000 });
  await page.goto("/menu");
  await expect(page.getByRole("link", { name: "Latte" }).first()).toBeVisible();
  expect(await stepDone(page, "Connect Square")).toBe(true);
});

test("F01-H4 hours, a transfer number (F01-E6 loop guard), where orders go, and a test order", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/location", { waitUntil: "networkidle" });
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) await page.getByRole("switch", { name: new RegExp(`^${day}`) }).first().click();
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved", { exact: true }).first()).toBeVisible();

  const aiNumber = (await (await apiAs(email)).call<{ e164: string }[]>("GET", `/locations/${(await apiAs(email)).locationId}/phone-numbers`))[0]!.e164;
  await page.goto("/agent/transfers", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add a number" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Front counter");
  await dialog.getByLabel("Phone number").fill(aiNumber.replace("+1", ""));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/That's your AI number/).first()).toBeVisible();
  await dialog.getByLabel("Phone number").fill("212 555 0177");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Front counter" }).first()).toBeVisible();

  await page.goto("/agent/orders", { waitUntil: "networkidle" });
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Restaurant approved Live orders in writing" }).click();
  await page.getByLabel("Sign-off note").fill("Approved by the owner by email today.");
  await page.getByRole("radio", { name: /The Live orders screen/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved where phone orders go", { exact: true }).first()).toBeVisible();

  await placeOrderInTestCall(page, "Almond Croissant", "Test Owner");
  for (const t of ["Get an AI phone number", "Connect Square", "Set your opening hours", "Add a transfer number", "Decide where phone orders go", "Place a test order"]) {
    expect(await stepDone(page, t), t).toBe(true);
  }
});

export async function placeOrderInTestCall(page: Page, item: string, customer: string, phone = "212 555 0123") {
  await page.goto("/agent/test", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start a test call" }).click();
  await page.waitForURL(/order=/);
  await page.getByLabel("What the caller said").fill(item.toLowerCase());
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: new RegExp(`^${item}`) }).first().click();
  await page.getByRole("button", { name: "Add to order" }).click();
  await page.getByText(new RegExp(`1 × ${item}`)).first().waitFor();
  await page.getByLabel("Caller's name").fill(customer);
  await page.getByLabel("Callback number").fill(phone);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.getByText(/Shall I send that in\?/).waitFor();
  await page.getByRole("button", { name: "Caller says yes" }).click();
  await page.getByRole("button", { name: "Send to the restaurant" }).click();
  await page.getByText("Last test call").waitFor();
}
