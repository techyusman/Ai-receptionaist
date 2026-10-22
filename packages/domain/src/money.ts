// Money is integer minor units plus a currency code. Never floats for arithmetic (spec §13.14).

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 10 ** digits);
}

/** Tax on a subtotal at a percentage rate, rounded half up to the minor unit. */
export function taxOn(subtotalMinor: number, ratePercent: number): number {
  // Work in basis points of a minor unit to keep the multiplication exact for typical rates.
  const scaled = Math.round(ratePercent * 10_000);
  return Math.floor((subtotalMinor * scaled + 500_000) / 1_000_000);
}

/** "+1 555 012 3456" from "+15550123456", for North American numbers; others pass through. */
export function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Last four digits only, for list views (spec §13.14: mask caller phone numbers). */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "Unknown caller";
  return `••• ${e164.slice(-4)}`;
}
