// F03 Caller places a pickup order, through the dashboard's test call (each button runs the same step the
// AI runs on a real call). F13: test orders are flagged Test and never alert the kitchen.
import type { Page } from "@playwright/test";
import { apiAs, axe, expect, guard, otherDevice, PEOPLE, placeTestOrder, signIn, test, unique } from "./fixtures";

async function startCall(page: Page) {
  await page.goto("/agent/test", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start a test call" }).click();
  await page.waitForURL(/order=/);
}

async function find(page: Page, said: string) {
  await page.getByLabel("What the caller said").fill(said);
  await page.getByRole("button", { name: "Find" }).click();
}

async function addLatte(page: Page, size: "Small" | "Large", milk: string) {
  await find(page, `${size.toLowerCase()} ${milk.toLowerCase()} latte`);
  await page.getByRole("button", { name: /^Latte/ }).click();
  await page.getByRole("radio", { name: new RegExp(`^${size} ·`) }).check();
  await page.getByRole("radio", { name: new RegExp(`^${milk}`) }).check();
  await page.getByRole("button", { name: "Add to order" }).click();
  await expect(page.getByText(/1 × Latte/).first()).toBeVisible();
}

async function customer(page: Page, name: string, phone: string) {
  await page.getByLabel("Caller's name").fill(name);
  await page.getByLabel("Callback number").fill(phone);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function ordersFor(name: string) {
  const a = await apiAs(PEOPLE.owner);
  const list = await a.call<{ items: { customer: { name: string | null } }[] }>("GET", `/locations/${a.locationId}/orders?range=today`);
  return list.items.filter((o) => o.customer.name === name);
}

test("F03-H1/F13-H1 a large oat latte from search to the Live orders screen, flagged Test", async ({ page }) => {
  const name = unique("Priya");
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  expect(await axe(page)).toEqual([]);
  await addLatte(page, "Large", "Oat milk");
  await customer(page, name, "212 555 0101");
  await expect(page.getByText("The AI reads it back digit by digit: 2 1 2 5 5 5 0 1 0 1.")).toBeVisible();
  await page.getByRole("button", { name: "Read it back" }).click();
  await expect(page.getByText(/That's 1 large Latte with oat milk\. Your total is \$\d+\.\d\d with tax/)).toBeVisible();
  await expect(page.getByText("Total, paid at pickup")).toBeVisible();
  await page.getByRole("button", { name: "Caller says yes" }).click();
  await page.getByRole("button", { name: "Send to the restaurant" }).click();
  await expect(page.getByRole("heading", { name: "Last test call" })).toBeVisible();
  await page.getByRole("link", { name: "See it on Live orders" }).click();
  await page.waitForURL("**/live");
  const ticket = page.getByRole("article", { name: `Order for ${name}` });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText("Test call", { exact: true })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("F03-E1 a latte with no milk chosen: the AI asks which milk and nothing is added", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  await find(page, "latte");
  await page.getByRole("button", { name: /^Latte/ }).click();
  await page.getByRole("radio", { name: /^Small ·/ }).check();
  await expect(page.getByText(/Choose a milk: Whole milk, Oat milk, Almond milk, Skim milk\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to order" })).toBeDisabled();
  await expect(page.getByText("Nothing yet. Ask for something on the left.")).toBeVisible();
});

test("F03-E2 the sold-out Pumpkin Loaf is never offered", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  await find(page, "pumpkin loaf");
  await expect(page.getByText(/I can't find that on our menu right now/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pumpkin Loaf/ })).toHaveCount(0);
});

test("F03-E3 changing the order after the read-back voids the yes", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  await addLatte(page, "Small", "Whole milk");
  await customer(page, unique("Change"), "212 555 0102");
  await page.getByRole("button", { name: "Read it back" }).click();
  await expect(page.getByRole("button", { name: "Caller says yes" })).toBeEnabled();
  await page.getByRole("button", { name: "Remove Latte" }).click();
  await expect(page.getByRole("button", { name: "Caller says yes" })).toBeDisabled();
  await addLatte(page, "Large", "Skim milk");
  await expect(page.getByRole("button", { name: "Caller says yes" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Read it back" })).toBeEnabled();
});

test("F03-E4/E7 a double-clicked Send makes one ticket, and an accented name with emoji shows exactly", async ({ page }) => {
  const name = `Zoë 🙂 ${Date.now() % 100000}`;
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  await addLatte(page, "Small", "Almond milk");
  await customer(page, name, "212 555 0103");
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.getByRole("button", { name: "Caller says yes" }).click();
  await page.getByRole("button", { name: "Send to the restaurant" }).dblclick();
  await expect(page.getByRole("heading", { name: "Last test call" })).toBeVisible();
  expect(await ordersFor(name)).toHaveLength(1);
  await page.goto("/live");
  await expect(page.getByRole("article", { name: `Order for ${name}` })).toHaveCount(1);
});

test("F03-E6 a 7-digit callback number is refused", async ({ page }) => {
  await signIn(page, PEOPLE.owner);
  await startCall(page);
  await addLatte(page, "Small", "Whole milk");
  await customer(page, unique("Short"), "555 0104");
  await expect(page.getByText("That isn't a 10-digit US number. Read it back digit by digit.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Read it back" })).toBeDisabled();
});

test("F03-E5 staff watching Live orders on another screen see a new ticket arrive with no reload", async ({ page, problems }) => {
  const staff = await otherDevice(page, problems, PEOPLE.staff);
  await staff.goto("/live", { waitUntil: "networkidle" });
  const name = unique("Arrives");
  await placeTestOrder(name);
  await expect(staff.getByRole("article", { name: `Order for ${name}` })).toBeVisible({ timeout: 15_000 });
});

test("BUG-006 a refused live stream comes back by itself and catches up", async ({ page }) => {
  // Its own guard: the one refused stream below is deliberate, anything else still fails the test.
  const seen: string[] = [];
  const context = await page.context().browser()!.newContext({ viewport: { width: 1024, height: 768 } });
  const staff = await context.newPage();
  guard(staff, seen, "[staff] ");
  await signIn(staff, PEOPLE.staff);
  let streams = 0;
  await staff.route("**/api/live", async (route) => {
    // The first stream is refused outright, as the route used to when the API was busy or restarting.
    if (streams++ === 0) return route.fulfill({ status: 502, body: "Live updates are unavailable." });
    return route.continue();
  });
  await staff.goto("/live", { waitUntil: "domcontentloaded" });
  await expect.poll(() => streams).toBeGreaterThan(0);
  const name = unique("Recovers");
  await placeTestOrder(name);
  await expect(staff.getByRole("article", { name: `Order for ${name}` })).toBeVisible({ timeout: 30_000 });
  expect(seen.filter((p) => !/502/.test(p))).toEqual([]);
  await context.close();
});
