// Shared by every spec: a guard that fails the test on any console error or 5xx response, signing in
// the way a person does, calling the API as a person (to set up data a test needs), reading the dev
// mailbox, and an axe accessibility scan.
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E } from "./ports";

export { expect };

export const PEOPLE = { owner: "maya@thirdspace.test", manager: "jordan@thirdspace.test", staff: "sam@thirdspace.test" } as const;
export const CODE = "246810";

/** Fails the test on console errors, uncaught page errors and any 5xx from our own servers. */
export function guard(page: Page, problems: string[], label = "") {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`${label}console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${label}page error: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${label}${r.status()} on ${r.request().method()} ${r.url()}`);
  });
}

export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      guard(page, problems);
      await use(problems);
      expect(problems, "console errors or server errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export async function signIn(page: Page, email: string, startUrl = "/login") {
  await page.goto(startUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** A second person on another device, with the same guards. */
export async function otherDevice(page: Page, problems: string[], email: string, viewport = { width: 1024, height: 768 }) {
  const context = await page.context().browser()!.newContext({ viewport });
  const p = await context.newPage();
  guard(p, problems, `[${email}] `);
  await signIn(p, email);
  return p;
}

/** Calls the API as a person, for setting up data a test needs (never to check what the screen shows). */
export async function apiAs(email: string) {
  const s = await fetch(`${E2E.auth}/auth/v1/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "email", email, token: CODE }) }).then((r) => r.json());
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${E2E.api}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${s.access_token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = r.status === 204 ? null : await r.json();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
    return j as T;
  };
  const me = await call<{ memberships: { restaurant: { id: string; slug: string }; locations: { id: string }[] }[] }>("GET", "/me");
  const m = me.memberships.find((x) => x.restaurant.slug === "third-space") ?? me.memberships[0];
  return { call, restaurantId: m?.restaurant.id ?? "", locationId: m?.locations[0]?.id ?? "" };
}

/** Places a dashboard test order end to end through the API and returns it (for screens that list orders). */
export async function placeTestOrder(customer: string, item = "cold brew") {
  const a = await apiAs(PEOPLE.owner);
  const t = `/locations/${a.locationId}/test-agent`;
  const { orderId } = await a.call<{ orderId: string }>("POST", `${t}/calls`, {});
  const found = await a.call<{ itemId: string; variations: { id: string }[] }[]>("GET", `${t}/search?q=${encodeURIComponent(item)}`);
  await a.call("POST", `${t}/orders/${orderId}/lines`, { itemId: found[0]!.itemId, variationId: found[0]!.variations[0]!.id, quantity: 1, modifiers: [] });
  await a.call("PUT", `${t}/orders/${orderId}/customer`, { name: customer, phone: "212 555 0144" });
  const rb = await a.call<{ version: number }>("POST", `${t}/orders/${orderId}/read-back`);
  await a.call("POST", `${t}/orders/${orderId}/confirm`, { version: rb.version });
  await a.call("POST", `${t}/orders/${orderId}/submit`);
  return orderId;
}

export async function mailTo(address: string): Promise<{ subject: string; text: string }[]> {
  return fetch(`${E2E.auth}/dev/mail?to=${encodeURIComponent(address)}`).then((r) => r.json());
}

/** WCAG 2.1 A and AA checks on what is on screen now. Returns readable violations (empty means clean). */
export async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

export const unique = (prefix: string) => `${prefix} ${Date.now() % 100000}`;

/** A second restaurant with its own owner, created the way /welcome does it. */
export async function newRestaurant(email: string, name: string) {
  const a = await apiAs(email);
  await a.call("POST", "/restaurants", {
    name,
    location: { name: "Main Street", timezone: "America/New_York", address: { line1: "12 Main St", city: "Brooklyn", region: "NY", postalCode: "11201", country: "US" } },
  });
  return apiAs(email);
}

/** Straight to the test database, for data no screen can make (a 300-character call summary). */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${E2E.ports.pg}/postgres` });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
