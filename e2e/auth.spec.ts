// Signing in and out, and what each role may open. Cases A-H1 ... A-N4 in replica/test-plan.md.
import { CODE, PEOPLE, axe, expect, signIn, test } from "./fixtures";

test.describe("sign-in", () => {
  test("A-H1 an owner signs in with an emailed code and lands on Overview", async ({ page }) => {
    await signIn(page, PEOPLE.owner);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("A-H2 staff land on Live orders", async ({ page }) => {
    await signIn(page, PEOPLE.staff);
    await expect(page).toHaveURL(/\/live$/);
  });

  test("A-H3 a protected link sends you to sign in and back to where you were going", async ({ page }) => {
    await page.goto("/calls?range=7d");
    await expect(page).toHaveURL(/\/login\?next=%2Fcalls%3Frange%3D7d/);
    await signIn(page, PEOPLE.owner, page.url());
    await expect(page).toHaveURL(/\/calls\?range=7d$/);
  });

  test("A-N1 a wrong code is refused with a message next to the field", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(PEOPLE.owner);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.getByLabel("6-digit code").fill("111111");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That code didn't work.", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("A-N2 an email that isn't an email is refused before anything is sent", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill("not an email");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByLabel("6-digit code")).toHaveCount(0);
  });

  test("A-E1 a tampered session cookie is treated as signed out", async ({ page, context }) => {
    await signIn(page, PEOPLE.owner);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "rcpt_session")!;
    await context.addCookies([{ ...session, value: Buffer.from(JSON.stringify({ access_token: "forged.token.value", refresh_token: "nope", expires_at: 4102444800 })).toString("base64url") }]);
    await page.goto("/calls");
    await expect(page).toHaveURL(/\/login/);
  });

  test("A-E4 a session the API refuses is cleared: the sign-in page shows once instead of reloading itself", async ({ page, context }) => {
    // What happens when the sign-in keys change (a fresh dev stack) or an account is deleted elsewhere.
    await signIn(page, PEOPLE.owner);
    const session = (await context.cookies()).find((c) => c.name === "rcpt_session")!;
    await context.addCookies([{ ...session, value: Buffer.from(JSON.stringify({ access_token: "refused.token.value", refresh_token: "nope", expires_at: 4102444800 })).toString("base64url") }]);
    let loginLoads = 0;
    page.on("request", (r) => void (new URL(r.url()).pathname === "/login" && loginLoads++));
    await page.goto("/calls");
    await expect(page.getByLabel("Work email")).toBeVisible();
    await page.waitForTimeout(3000);
    expect(loginLoads, "the sign-in page loads a few times at most, not in a loop").toBeLessThan(5);
    expect((await context.cookies()).some((c) => c.name === "rcpt_session"), "the dead session cookie is gone").toBe(false);
  });

  test("A-E2 an expired session is renewed silently by the proxy", async ({ page, context }) => {
    await signIn(page, PEOPLE.owner);
    const session = (await context.cookies()).find((c) => c.name === "rcpt_session")!;
    const parsed = JSON.parse(Buffer.from(session.value, "base64url").toString("utf8"));
    await context.addCookies([{ ...session, value: Buffer.from(JSON.stringify({ ...parsed, expires_at: Math.floor(Date.now() / 1000) - 10 })).toString("base64url") }]);
    await page.goto("/calls");
    await expect(page.getByRole("heading", { name: "Calls" })).toBeVisible();
    const renewed = JSON.parse(Buffer.from((await context.cookies()).find((c) => c.name === "rcpt_session")!.value, "base64url").toString("utf8"));
    expect(renewed.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("A-H4 signing out ends the session", async ({ page }) => {
    await signIn(page, PEOPLE.owner);
    await page.getByRole("button", { name: /Account menu|Maya Okafor/ }).first().click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("A-E3 the session cookie can't be read by page scripts", async ({ page, context }) => {
    await signIn(page, PEOPLE.owner);
    const session = (await context.cookies()).find((c) => c.name === "rcpt_session")!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain("rcpt_session");
  });
});

test.describe("roles", () => {
  test("A-N3 staff see 'no access' on configuration pages", async ({ page }) => {
    await signIn(page, PEOPLE.staff);
    for (const path of ["/agent", "/knowledge", "/analytics", "/settings/team", "/square", "/agent/test"]) {
      await page.goto(path);
      await expect(page.getByRole("main").getByText("You don't have access to this page"), path).toBeVisible();
    }
  });

  test("A-N4 a manager can't open the audit log", async ({ page }) => {
    await signIn(page, PEOPLE.manager);
    await page.goto("/settings/audit");
    await expect(page.getByRole("main").getByText("You don't have access to this page")).toBeVisible();
  });
});

void CODE;
