// X-2 accessibility (axe WCAG 2.1 AA) and X-3 no sideways scrolling, on every screen at desktop and phone
// width; X-4 the core moves by keyboard alone. F01-E9 and F03-E13 are the phone-width rows.
import type { Page } from "@playwright/test";
import { apiAs, axe, expect, PEOPLE, signIn, test } from "./fixtures";

const SCREENS = [
  "/", "/live", "/calls", "/orders", "/callbacks", "/menu", "/menu?tab=categories", "/menu?tab=lists", "/knowledge",
  "/agent", "/agent/call-handling", "/agent/orders", "/agent/transfers", "/agent/voice", "/agent/phone", "/agent/test",
  "/location", "/square", "/analytics", "/settings/team", "/settings/audit", "/account", "/setup", "/kitchen",
];

async function drawers() {
  const a = await apiAs(PEOPLE.owner);
  const order = (await a.call<{ items: { id: string }[] }>("GET", `/locations/${a.locationId}/orders?range=30d`)).items[0]!;
  const call = (await a.call<{ items: { id: string }[] }>("GET", `/locations/${a.locationId}/calls?range=30d`)).items[0]!;
  const item = (await a.call<{ items: { id: string }[] }>("GET", `/locations/${a.locationId}/menu`)).items[0]!;
  return [`/orders?range=30d&order=${order.id}`, `/calls?range=30d&call=${call.id}`, `/menu?item=${item.id}`];
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const width of [1440, 390]) {
  test(`X-2/X-3 every owner screen at ${width} px: no axe violations${width < 500 ? ", no sideways scrolling" : ""}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.goto("/login", { waitUntil: "networkidle" });
    const found: string[] = (await axe(page)).map((v) => `/login: ${v}`);
    await signIn(page, PEOPLE.owner);
    for (const path of [...SCREENS, ...(await drawers())]) {
      await page.goto(path, { waitUntil: "networkidle" });
      found.push(...(await axe(page)).map((v) => `${path}: ${v}`));
      if (width < 500) {
        const extra = await sideways(page);
        if (extra > 0) found.push(`${path}: scrolls sideways by ${extra}px`);
      }
    }
    expect(found).toEqual([]);
  });
}

test("F01-E9 onboarding at phone width: every field reachable, no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, `phone${Date.now() % 100000}@newcafe.test`);
  await expect(page).toHaveURL(/\/welcome$/);
  expect(await axe(page)).toEqual([]);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  for (const label of ["Restaurant name", "Street address", "City", "State", "ZIP code"]) {
    await page.getByLabel(label).scrollIntoViewIfNeeded();
    await expect(page.getByLabel(label)).toBeInViewport();
  }
  await expect(page.getByRole("button", { name: "Create restaurant" })).toBeEnabled();
});

test("F03-E13 staff on Live orders and the kitchen screen at phone width: readable, Accept within reach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, PEOPLE.staff);
  for (const path of ["/live", "/kitchen"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    expect(await axe(page), path).toEqual([]);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
    const accept = page.getByRole("button", { name: /^Accept order for / }).first();
    if (await accept.count()) {
      await accept.scrollIntoViewIfNeeded();
      const box = (await accept.boundingBox())!;
      expect(box.x + box.width, `${path}: Accept fits on screen`).toBeLessThanOrEqual(390);
      expect(box.height, `${path}: Accept is a comfortable target`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("X-4 keyboard only: sign in, skip to content, move between screens, open and close a drawer", async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Work email").focus();
  await page.keyboard.type(PEOPLE.manager);
  await page.keyboard.press("Enter");
  await page.getByLabel("6-digit code").waitFor();
  await page.getByLabel("6-digit code").focus();
  await page.keyboard.type("246810");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/orders?range=30d", { waitUntil: "networkidle" });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  /** Tabs forward until the focused element matches, checking the focus ring is visible on the way. */
  const reach = async (name: RegExp, where: "table" | "nav" | "any" = "any", max = 80) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          text: (el.getAttribute("aria-label") ?? el.innerText ?? "").trim(),
          table: !!el.closest("table"),
          nav: !!el.closest("nav"),
          ring: style.outlineStyle !== "none" || style.boxShadow !== "none",
        };
      });
      if (f && name.test(f.text) && (where === "any" || f[where])) {
        expect(f.ring, `focus is visible on ${f.text}`).toBe(true);
        return;
      }
    }
    throw new Error(`couldn't reach ${name} with Tab`);
  };

  await reach(/./, "table");
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/order=/);

  await page.goto("/live", { waitUntil: "networkidle" });
  await reach(/^Calls$/, "nav");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calls/);
});
