// F06 A manager reviews a call; F07 checks an order, or cancels one. Staff see less of both.
import { apiAs, axe, expect, otherDevice, PEOPLE, placeTestOrder, signIn, sql, test, unique } from "./fixtures";

type CallRow = { id: string; callerName: string | null; outcome: string | null; isTest: boolean };

async function seededCall(outcome = "all") {
  const a = await apiAs(PEOPLE.owner);
  const page = await a.call<{ items: CallRow[] }>("GET", `/locations/${a.locationId}/calls?range=30d&outcome=${outcome}`);
  const call = page.items.find((c) => c.callerName && !c.isTest);
  if (!call) throw new Error(`no seeded ${outcome} call with a name`);
  return call as CallRow & { callerName: string };
}

test("F06-H1 filter calls by outcome, search by name, and open one", async ({ page }) => {
  const call = await seededCall("ORDER_SUBMITTED");
  await signIn(page, PEOPLE.manager);
  await page.goto("/calls?range=30d", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByRole("combobox", { name: "Outcome" }).selectOption({ label: "Order placed" });
  await page.getByRole("textbox", { name: "Search" }).fill(call.callerName);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/outcome=ORDER_SUBMITTED/);
  const table = page.getByRole("table", { name: "Calls, newest first" });
  const rows = table.getByRole("row").filter({ has: page.getByRole("link") });
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    await expect(row).toContainText(call.callerName);
    await expect(row).toContainText("Order placed");
  }
  await rows.first().getByRole("link").first().click();
  const drawer = page.getByRole("dialog", { name: `Call from ${call.callerName}` });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "What happened" })).toBeVisible();
  await expect(drawer).toContainText("+1 ");
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/call=/);
});

test("F06-E1 staff see the caller's number masked and no transcript", async ({ page }) => {
  const call = await seededCall("ORDER_SUBMITTED");
  await signIn(page, PEOPLE.staff);
  await page.goto(`/calls?range=30d&call=${call.id}`, { waitUntil: "networkidle" });
  const drawer = page.getByRole("dialog", { name: `Call from ${call.callerName}` });
  await expect(drawer).toContainText("•••");
  await expect(drawer).not.toContainText("+1 ");
  await expect(drawer.getByText(/Caller: /)).toHaveCount(0);
});

test("F06-E3 a 300-character summary wraps inside the table and the drawer", async ({ page }) => {
  const call = await seededCall();
  const long = `Asked about ${"the seasonal menu and whether the oat milk is unsweetened, ".repeat(6)}`.slice(0, 300);
  await sql("update calls set summary = $1 where id = $2", [long, call.id]);
  await signIn(page, PEOPLE.manager);
  await page.goto(`/calls?range=30d&q=${encodeURIComponent(call.callerName)}`, { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
  await page.goto(`/calls?range=30d&call=${call.id}`, { waitUntil: "networkidle" });
  const drawer = page.getByRole("dialog", { name: `Call from ${call.callerName}` });
  await expect(drawer.getByText(long)).toBeVisible();
  const box = await drawer.getByText(long).boundingBox();
  const panel = await drawer.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
});

test("F06-E4 a very long search, or a broken link to a call, doesn't break the screen", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/calls", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Search" }).fill("pumpkin ".repeat(12));
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/q=pumpkin/);
  await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible();
  await expect(page.getByText("This screen didn't load")).toHaveCount(0);
  await page.goto("/calls?call=not-a-real-id", { waitUntil: "networkidle" });
  await expect(page.getByText("Call not found")).toBeVisible();
  await page.goto("/orders?order=not-a-real-id", { waitUntil: "networkidle" });
  await expect(page.getByText("Order not found")).toBeVisible();
});

test("F07-H1 order views with counts, and an order's timeline from draft to accepted", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/orders?range=30d", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  const views = page.getByRole("navigation", { name: "Order status" });
  for (const v of ["Open", "Needs attention", "Accepted", "All"]) await expect(views.getByRole("link", { name: new RegExp(`^${v} \\d+$`) })).toBeVisible();
  await views.getByRole("link", { name: /^Accepted \d+$/ }).click();
  await expect(page).toHaveURL(/view=accepted/);
  const table = page.getByRole("table", { name: "Phone orders, newest first" });
  const rows = table.getByRole("row").filter({ has: page.getByRole("link") });
  await expect(rows.first()).toBeVisible();
  for (const row of (await rows.all()).slice(0, 5)) await expect(row).toContainText("Accepted");
  await rows.first().getByRole("link").first().click();
  const drawer = page.getByRole("dialog", { name: /^Order for / });
  await expect(drawer.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(drawer.getByRole("listitem").filter({ hasText: /Started: / })).toHaveCount(1);
  await expect(drawer.getByRole("listitem").filter({ hasText: /→ Accepted/ })).toHaveCount(1);
  expect(await axe(page)).toEqual([]);
});

test("F07-H2/N1 a manager cancels an order: a reason is required, and it lands on the timeline and in the audit log", async ({ page, problems }) => {
  const name = unique("Cancelme");
  const id = await placeTestOrder(name);
  const reason = "Out of oat milk, customer chose to cancel";
  await signIn(page, PEOPLE.manager);
  await page.goto(`/orders?order=${id}`, { waitUntil: "networkidle" });
  const drawer = page.getByRole("dialog", { name: `Order for ${name}` });
  await drawer.getByRole("button", { name: "Cancel order" }).click();
  const confirm = page.getByRole("dialog", { name: `Cancel ${name}'s order?` });
  await confirm.getByRole("textbox", { name: "Why?" }).fill("x");
  await confirm.getByRole("button", { name: "Cancel order" }).click();
  await expect(confirm.getByText("Say why, so the team knows later.")).toBeVisible();
  await confirm.getByRole("textbox", { name: "Why?" }).fill(reason);
  await confirm.getByRole("button", { name: "Cancel order" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Order cancelled", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByRole("listitem").filter({ hasText: reason })).toHaveCount(1);
  await expect(drawer.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

  const owner = await otherDevice(page, problems, PEOPLE.owner);
  await owner.goto("/settings/audit", { waitUntil: "networkidle" });
  await expect(owner.getByRole("table", { name: "Audit log, newest first" }).getByText(`Cancelled: ${reason}`)).toBeVisible();
});

test("F07-E1/N2 staff double-tap Accept: accepted once, no error; and staff are never offered Cancel", async ({ page }) => {
  const name = unique("Tapped");
  const id = await placeTestOrder(name);
  await signIn(page, PEOPLE.staff);
  await page.goto("/live", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Accept order for ${name}` }).dblclick();
  // It moves to the accepted section (a test ticket keeps its "Test call" mark instead of a status pill).
  await expect(page.getByRole("button", { name: `Accept order for ${name}` })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Accepted in the last 30 minutes/ })).toBeVisible();
  await expect(page.getByRole("article", { name: `Order for ${name}` })).toBeVisible();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByRole("listitem")).toHaveCount(0);
  const a = await apiAs(PEOPLE.owner);
  const detail = await a.call<{ status: string; events: { to: string }[] }>("GET", `/orders/${id}`);
  expect(detail.status).toBe("RECEIVED_BY_RESTAURANT");
  expect(detail.events.filter((e) => e.to === "RECEIVED_BY_RESTAURANT")).toHaveLength(1);
  await page.goto(`/orders?order=${id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: `Order for ${name}` }).getByRole("button", { name: "Cancel order" })).toHaveCount(0);
});
