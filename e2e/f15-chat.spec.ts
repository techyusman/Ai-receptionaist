// F15 Text the AI the way a customer would (the test chat), at the second sample restaurant, whose bigger
// menu is synced like the first. The suite runs the chat on the scripted stand-in (no AI key), which picks
// tools by keyword and runs them for real: enough to prove the screen and the plumbing, not the model.
import { axe, expect, signIn, test } from "./fixtures";

const ALI = "ali@tandoorcrust.test";

test("F15-H1 chat with the AI: greeting, hours and a menu search through the real tools, then end the chat", async ({ page }) => {
  await signIn(page, ALI);
  await page.goto("/agent/chat", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Chat with your AI", level: 1 })).toBeVisible();
  await expect(page.getByText("Replies come from a scripted stand-in, not a real AI")).toBeVisible();
  expect(await axe(page)).toEqual([]);

  const chat = page.getByRole("region", { name: "Chat with Tandoor & Crust" });
  const log = chat.getByRole("log", { name: "Messages" });
  await chat.getByRole("button", { name: "Start chat" }).click();
  await expect(log.getByText(/Assalam-o-alaikum, and thanks for calling Tandoor & Crust/)).toBeVisible();

  await chat.getByLabel("Message", { exact: true }).fill("What are your hours today?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(log.getByText("What are your hours today?")).toBeVisible();
  await expect(log.getByText(/We're (open now|closed right now)\. Today: /)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Looked up hours." })).toBeVisible();

  await chat.getByLabel("Message", { exact: true }).fill("biryani");
  await chat.getByLabel("Message", { exact: true }).press("Enter");
  await expect(log.getByText(/We have Biryani/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /Searched the menu for “biryani” \(\d+ found\)\./ })).toBeVisible();

  await chat.getByLabel("Message", { exact: true }).fill("is the meat halal?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(log.getByText("Yes, everything we serve is halal: chicken, beef and mutton from a certified supplier.")).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await chat.getByRole("button", { name: "End chat" }).click();
  await expect(log.getByText("You ended the chat.")).toBeVisible();
  await expect(chat.getByText("chat ended", { exact: true })).toBeVisible();

  // The chat is a test call: it's in the call history, flagged as a test.
  await page.goto("/calls", { waitUntil: "networkidle" });
  await expect(page.getByRole("table", { name: "Calls, newest first" }).getByRole("row").filter({ hasText: "Test chat from the dashboard." }).first()).toBeVisible();
});

test("F15-E1 the chat at phone width: readable, no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ALI);
  await page.goto("/agent/chat", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Start chat" }).click();
  await expect(page.getByRole("log", { name: "Messages" }).getByText(/Assalam-o-alaikum/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("F15-N1/E5 staff can't open the chat; the bigger menu is there with its choices", async ({ page }) => {
  await signIn(page, "sara@tandoorcrust.test");
  await page.goto("/agent/chat", { waitUntil: "networkidle" });
  await expect(page.getByRole("main").getByText("You don't have access to this page")).toBeVisible();

  await page.goto("/menu", { waitUntil: "networkidle" });
  const table = page.getByRole("table", { name: "Menu items" });
  for (const name of ["Zinger Burger", "Chicken Tikka Pizza", "Mutton Karahi", "Biryani"]) await expect(table.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Beef Nihari" })).toContainText("Sold out in Square");
  await expect(table.getByRole("row").filter({ hasText: "Biryani Tray" })).toContainText("No fixed price");
  await expect(table.getByRole("link", { name: "Latte", exact: true })).toHaveCount(0);
});
