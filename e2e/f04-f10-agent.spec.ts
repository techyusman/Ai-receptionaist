// F04/F05/F10 The AI agent's settings: transfer numbers, Ring Staff First, the greeting (and the warning
// when it doesn't say it's an AI), pronunciations. What the voice agent does with them is covered by the
// server's voice and tools tests.
import { axe, expect, PEOPLE, signIn, test } from "./fixtures";

test("F04-H2 add, edit and remove a transfer number", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/agent/transfers", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Add a number" }).click();
  const add = page.getByRole("dialog", { name: "Add a transfer number" });
  await add.getByLabel("Name").fill("Catering line");
  await add.getByLabel("Phone number").fill("212 555 0188");
  await add.getByRole("combobox", { name: "Use it for" }).click();
  await page.getByRole("option", { name: "Catering and large orders" }).click();
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add).toBeHidden();
  const table = page.getByRole("table", { name: "Transfer numbers" });
  await expect(table.getByRole("row").filter({ hasText: "Catering line" })).toContainText("Catering");

  await page.getByRole("button", { name: "Edit Catering line" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Catering line" });
  await edit.getByLabel("Name").fill("Catering desk");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(table.getByRole("cell", { name: "Catering desk", exact: true })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Catering line", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Remove Catering desk" }).click();
  await page.getByRole("dialog", { name: "Remove Catering desk?" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Removed Catering desk", { exact: true }).first()).toBeVisible();
  await expect(table.getByRole("cell", { name: "Catering desk", exact: true })).toHaveCount(0);
});

test("F05-H2 switch Ring Staff First on: it's saved and survives a reload", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/agent/call-handling", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  const ring = page.getByRole("switch", { name: /^Ring staff first/ });
  await expect(ring).toHaveAttribute("aria-checked", "false");
  await ring.click();
  await expect(page.getByLabel("Seconds before the AI answers")).toBeVisible();
  const answering = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Answering" }) }).last();
  await answering.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("switch", { name: /^Ring staff first/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: /^Ring staff first/ }).click();
  await answering.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
});

test("F10-H1/E1 change the greeting; one that doesn't say it's an AI gets a warning but still saves", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/agent", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  const greeting = page.getByLabel("Greeting");
  const original = await greeting.inputValue();
  await expect(page.getByText("Say it's an AI", { exact: true })).toHaveCount(0);
  await greeting.fill("Hi, you've reached Third Space. How can I help?");
  await expect(page.getByText("Say it's an AI", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved. New calls use it straight away.", { exact: true }).first()).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Greeting")).toHaveValue("Hi, you've reached Third Space. How can I help?");
  await page.getByLabel("Greeting").fill(original);
  await expect(page.getByText("Say it's an AI", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved. New calls use it straight away.", { exact: true }).first()).toBeVisible();
});

test("F10-H2 add a pronunciation; the same word again is refused", async ({ page }) => {
  await signIn(page, PEOPLE.manager);
  await page.goto("/agent/voice", { waitUntil: "networkidle" });
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Word").fill("Okafor");
  await page.getByLabel("Say it like").fill("oh-KAH-for");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added Okafor", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Okafor sounds like “oh-KAH-for”")).toBeVisible();
  await page.getByLabel("Word").fill("okafor");
  await page.getByLabel("Say it like").fill("oh-kah-FOR");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("That word is already on the list.")).toBeVisible();
});
