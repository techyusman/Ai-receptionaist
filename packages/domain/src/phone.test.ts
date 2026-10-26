import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPhone, prettyPhone, readBackDigits, toE164 } from "./phone.ts";

test("US numbers, as typed in a US restaurant", () => {
  assert.equal(toE164("212 555 0101"), "+12125550101");
  assert.equal(toE164("(212) 555-0101", "US"), "+12125550101");
  assert.equal(toE164("1 212 555 0101"), "+12125550101");
  assert.equal(toE164("555 0101"), null, "seven digits isn't a full number");
});

test("Pakistani numbers, as typed in a Pakistani restaurant", () => {
  assert.equal(toE164("0300 1234567", "PK"), "+923001234567");
  assert.equal(toE164("0300-1234567", "PK"), "+923001234567");
  assert.equal(toE164("300 1234567", "PK"), "+923001234567");
  assert.equal(toE164("042 3500 0189", "PK"), "+924235000189");
  assert.equal(toE164("92 300 1234567", "PK"), "+923001234567");
  assert.equal(toE164("0300 12345", "PK"), null);
});

test("a + or 00 and a country code works in any restaurant", () => {
  assert.equal(toE164("+92 300 1234567", "US"), "+923001234567");
  assert.equal(toE164("0092 300 1234567", "US"), "+923001234567");
  assert.equal(toE164("+1 212 555 0101", "PK"), "+12125550101");
  assert.equal(toE164("+12", "US"), null);
});

test("shown and read back the way people say them", () => {
  assert.equal(prettyPhone("+12125550101"), "+1 212 555 0101");
  assert.equal(prettyPhone("+923001234567"), "+92 300 123 4567");
  assert.equal(prettyPhone("+924235000189"), "+92 42 3500 0189");
  assert.equal(prettyPhone("+447700900123"), "+447700900123");
  assert.equal(readBackDigits("+12125550101"), "2 1 2, 5 5 5, 0 1 0 1");
  assert.equal(readBackDigits("+923001234567"), "0 3 0 0, 1 2 3, 4 5 6 7");
  assert.equal(readBackDigits("+924235000189"), "0 4 2, 3 5 0 0, 0 1 8 9");
  assert.equal(maskPhone("+923001234567"), "••• 4567");
});
