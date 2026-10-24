// X-1 Another restaurant's owner, signed in, opens links to Third Space's order, call and menu item:
// nothing of Third Space shows. (The API side, every route, is in apps/server/test/tenancy.test.ts.)
import { apiAs, expect, newRestaurant, PEOPLE, signIn, test } from "./fixtures";

test("X-1/F06-E2 a second restaurant sees none of the first one's orders, calls or menu", async ({ page }) => {
  const a = await apiAs(PEOPLE.owner);
  const order = (await a.call<{ items: { id: string }[] }>("GET", `/locations/${a.locationId}/orders?range=30d`)).items[0]!;
  const call = (await a.call<{ items: { id: string }[] }>("GET", `/locations/${a.locationId}/calls?range=30d`)).items[0]!;
  const menu = await a.call<{ items: { id: string; name: string }[] }>("GET", `/locations/${a.locationId}/menu`);
  const latte = menu.items.find((i) => i.name === "Latte")!;

  const rival = `owner${Date.now() % 100000}@rivalcafe.test`;
  await newRestaurant(rival, "Rival Cafe");
  await signIn(page, rival);

  await page.goto(`/orders?order=${order.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Order not found")).toBeVisible();
  await page.goto(`/calls?call=${call.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Call not found")).toBeVisible();
  await page.goto(`/menu?item=${latte.id}`, { waitUntil: "networkidle" });
  await expect(page.getByText("Item not found")).toBeVisible();
  await page.goto("/live", { waitUntil: "networkidle" });
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goto("/calls?range=all", { waitUntil: "networkidle" });
  await expect(page.getByText("No calls yet")).toBeVisible();
});
