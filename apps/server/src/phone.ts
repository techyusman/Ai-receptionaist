// Phone numbers people give the AI or the dashboard, read in the restaurant's own country: a Lahore
// customer says 0300 1234567, a New York one 212 555 0101. A number with + and a country code works
// anywhere. Validation uses libphonenumber's rules for each country.
import parsePhone, { type CountryCode } from "libphonenumber-js";

export function parseLocalPhone(raw: string, country: string | null | undefined): string | null {
  try {
    const p = parsePhone(raw, ((country ?? "US").toUpperCase() || "US") as CountryCode);
    return p?.isValid() ? p.number : null;
  } catch {
    return null;
  }
}

/** What to say when a number isn't complete, with an example the customer will recognise. */
export function phoneProblem(country: string | null | undefined): string {
  if ((country ?? "US").toUpperCase() === "PK") return "That isn't a full Pakistani number, like 0300 1234567. Read it back digit by digit.";
  return "That isn't a 10-digit US number. Read it back digit by digit.";
}
