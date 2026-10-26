// Money is integer minor units plus a currency code. Never floats for arithmetic (spec §13.14).

// Decimal places in each currency's minor unit (ISO 4217), which is how Square and this app store amounts.
// Not what Intl shows: it shows rupees without decimals, though a rupee is still 100 paisa.
const NO_DECIMALS = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMALS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const minorDigits = (currency: string) => (NO_DECIMALS.has(currency.toUpperCase()) ? 0 : THREE_DECIMALS.has(currency.toUpperCase()) ? 3 : 2);

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const digits = minorDigits(currency);
  const amount = minor / 10 ** digits;
  // Shown the local way (whole rupees without ".00"), but a part amount always shows every digit.
  const usual = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? digits;
  const fraction = Number.isInteger(amount) ? Math.min(usual, digits) : digits;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(amount);
}

/** Tax on a subtotal at a percentage rate, rounded half up to the minor unit. */
export function taxOn(subtotalMinor: number, ratePercent: number): number {
  // Work in basis points of a minor unit to keep the multiplication exact for typical rates.
  const scaled = Math.round(ratePercent * 10_000);
  return Math.floor((subtotalMinor * scaled + 500_000) / 1_000_000);
}
