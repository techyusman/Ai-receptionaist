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
