// Phone numbers are read in the restaurant's own country: 0300 1234567 is a full number in Lahore and
// not in New York, where 212 555 0101 is. A number with + and a country code works in both.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalPhone, phoneProblem } from "../src/phone.ts";
import { newUser, signUp, startHarness, type Harness, type TestUser } from "./harness.ts";

describe("reading a phone number in the restaurant's country", () => {
  test("Pakistani and US numbers, local or international", () => {
    assert.equal(parseLocalPhone("0300 1234567", "PK"), "+923001234567");
    assert.equal(parseLocalPhone("0300-1234567", "PK"), "+923001234567");
    assert.equal(parseLocalPhone("042 3500 0189", "PK"), "+924235000189");
    assert.equal(parseLocalPhone("+92 300 1234567", "US"), "+923001234567");
    assert.equal(parseLocalPhone("212 555 0101", "US"), "+12125550101");
    assert.equal(parseLocalPhone("+1 212 555 0101", "PK"), "+12125550101");
    assert.equal(parseLocalPhone("0300 1234567", "US"), null);
    assert.equal(parseLocalPhone("0300 12345", "PK"), null);
    assert.equal(parseLocalPhone("212 555 0101", null), "+12125550101", "no country means US, as before");
    assert.match(phoneProblem("PK"), /0300 1234567/);
    assert.match(phoneProblem("US"), /10-digit US number/);
  });
});

describe("the dashboard's test call, in Lahore and in New York", () => {
  let h: Harness;
  const ali = newUser("Ali Owner");
  const maya = newUser("Maya Owner");
  let lahore: string;
  let newYork: string;

  before(async () => {
    h = await startHarness();
    const r = await h.call(ali, "POST", "/restaurants", {
      name: "Tandoor & Crust",
      location: { name: "Gulberg", timezone: "Asia/Karachi", address: { line1: "24-B Main Boulevard", city: "Lahore", region: "Punjab", postalCode: "54660", country: "PK" } },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    lahore = r.body.locationId;
    newYork = (await signUp(h, maya, "Third Space")).locationId;
  });
  after(async () => {
    await h.stop();
  });

  const giveNumber = async (who: TestUser, lid: string, phone: string) => {
    const started = await h.call(who, "POST", `/locations/${lid}/test-agent/calls`, {});
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const set = await h.call(who, "PUT", `/locations/${lid}/test-agent/orders/${started.body.orderId}/customer`, { name: "Usman", phone });
    const order = await h.call(who, "GET", `/locations/${lid}/test-agent/orders/${started.body.orderId}`);
    return { set, phone: order.body.customer?.phone as string | null };
  };

  test("a Lahore restaurant takes 0300 1234567 and stores it as +92", async () => {
    const { set, phone } = await giveNumber(ali, lahore, "0300 1234567");
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(phone, "+923001234567");
  });

  test("a New York restaurant refuses it, with an example its customers know, but takes it written with +92", async () => {
    const refused = await giveNumber(maya, newYork, "0300 1234567");
    assert.equal(refused.set.status, 422);
    assert.match(refused.set.body.error.message, /10-digit US number/);
    const international = await giveNumber(maya, newYork, "+92 300 1234567");
    assert.equal(international.set.status, 200);
    assert.equal(international.phone, "+923001234567");
  });

  test("in Lahore a US-style local number isn't full, and the message shows a Pakistani example", async () => {
    const { set } = await giveNumber(ali, lahore, "555 0101");
    assert.equal(set.status, 422);
    assert.match(set.body.error.message, /0300 1234567/);
  });
});
