// F14 The owner invites a teammate by email; X-5 deleting your own account. Emails land in the dev
// mailbox, so the test opens the same link a person would click.
import type { Browser, Page } from "@playwright/test";
import { axe, CODE, expect, guard, mailTo, PEOPLE, signIn, test } from "./fixtures";

test.describe.configure({ mode: "serial" });
const stamp = Date.now() % 100000;
const joiner = `alex${stamp}@thirdspace.test`;

async function invite(page: Page, email: string, role: "Staff" | "Manager" = "Staff") {
  await page.goto("/settings/team", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Invite someone" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByLabel("Email").fill(email);
  if (role === "Manager") {
    await dialog.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Manager" }).click();
  }
  await dialog.getByRole("button", { name: "Send invite" }).click();
  return dialog;
}

async function inviteLink(email: string) {
  const mail = (await mailTo(email)).at(-1);
  expect(mail, `an invitation email to ${email}`).toBeTruthy();
  return /(http\S+\/invite\?token=\S+)/.exec(mail!.text)![1]!;
}

/** A fresh browser for someone else, guarded like the main page. */
async function person(browser: Browser, problems: string[], label: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  guard(p, problems, `[${label}] `);
  return p;
}

test("F14-H1 invite a teammate: they open the emailed link, sign in, accept, and are on the team", async ({ page, browser, problems }) => {
  await signIn(page, PEOPLE.owner);
  await page.goto("/settings/team", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await expect(await invite(page, joiner)).toBeHidden();
  await expect(page.getByText(`Invitation sent to ${joiner}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`^${joiner.replace(".", "\\.")} · Staff · invited by`))).toBeVisible();

  const alex = await person(browser, problems, joiner);
  await alex.goto(await inviteLink(joiner), { waitUntil: "networkidle" });
  await alex.getByRole("link", { name: "Sign in to accept" }).click();
  await alex.getByLabel("Work email").fill(joiner);
  await alex.getByRole("button", { name: "Email me a code" }).click();
  await alex.getByLabel("6-digit code").fill(CODE);
  await alex.getByRole("button", { name: "Sign in" }).click();
  await alex.waitForURL(/\/invite\?token=/);
  await expect(alex.getByText(`You're signed in as ${joiner}.`)).toBeVisible();
  await alex.getByRole("button", { name: "Accept and join" }).click();
  await alex.waitForURL((u) => u.pathname === "/");
  await alex.goto("/live", { waitUntil: "networkidle" });
  await expect(alex.getByRole("heading", { name: "Live orders", level: 1 })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("table", { name: "Team members" }).getByRole("row").filter({ hasText: joiner })).toContainText("Staff");
});

test("F14-E1 the same link can't be used twice", async ({ browser, problems }) => {
  const alex = await person(browser, problems, joiner);
  await signIn(alex, joiner);
  await alex.goto(await inviteLink(joiner), { waitUntil: "networkidle" });
  await alex.getByRole("button", { name: "Accept and join" }).click();
  await expect(alex.getByRole("alert").filter({ hasText: "That invitation has expired or was cancelled. Ask for a new one." })).toBeVisible();
});

test("F14-E2/E3/N1 the wrong person, a cancelled invite, and an address that isn't one", async ({ page, browser, problems }) => {
  const other = `casey${stamp}@thirdspace.test`;
  const revoked = `drew${stamp}@thirdspace.test`;
  await signIn(page, PEOPLE.owner);
  const bad = await invite(page, "not-an-email");
  await expect(bad.getByText("Enter a valid email address.")).toBeVisible();
  await bad.getByRole("button", { name: "Cancel" }).click();

  await expect(await invite(page, other)).toBeHidden();
  const jordan = await person(browser, problems, PEOPLE.manager);
  await signIn(jordan, PEOPLE.manager);
  await jordan.goto(await inviteLink(other), { waitUntil: "networkidle" });
  await jordan.getByRole("button", { name: "Accept and join" }).click();
  await expect(jordan.getByRole("alert").filter({ hasText: `This invitation was sent to ${other}. Sign in with that email to accept it.` })).toBeVisible();

  await expect(await invite(page, revoked)).toBeHidden();
  await page.getByRole("listitem").filter({ hasText: revoked }).getByRole("button", { name: "Cancel invite" }).click();
  await expect(page.getByText("Invitation cancelled", { exact: true }).first()).toBeVisible();
  const drew = await person(browser, problems, revoked);
  await signIn(drew, revoked);
  await drew.goto(await inviteLink(revoked), { waitUntil: "networkidle" });
  await drew.getByRole("button", { name: "Accept and join" }).click();
  await expect(drew.getByRole("alert").filter({ hasText: "That invitation has expired or was cancelled. Ask for a new one." })).toBeVisible();
});

test("F14-N2 a manager sees the team but can't invite", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/settings/team", { waitUntil: "networkidle" });
  await expect(page.getByRole("table", { name: "Team members" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite someone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel invite" })).toHaveCount(0);
});

test("X-5 the owner can't delete their account; a staff member can, and is out of the team for good", async ({ page, browser, problems }) => {
  await signIn(page, PEOPLE.owner);
  await page.goto("/account", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByRole("dialog", { name: "Delete your account?" }).getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText(/^You own Third Space\. Hand the restaurant to someone else or close it before deleting your account\.$/).first()).toBeVisible();

  const alex = await person(browser, problems, joiner);
  await signIn(alex, joiner);
  await alex.goto("/account", { waitUntil: "networkidle" });
  await alex.getByRole("button", { name: "Delete my account" }).click();
  await alex.getByRole("dialog", { name: "Delete your account?" }).getByRole("button", { name: "Delete my account" }).click();
  await alex.waitForURL(/\/login/);
  await signIn(alex, joiner);
  await expect(alex).toHaveURL(/\/welcome/);

  await page.goto("/settings/team", { waitUntil: "networkidle" });
  await expect(page.getByRole("table", { name: "Team members" }).getByRole("row").filter({ hasText: joiner })).toHaveCount(0);
});
