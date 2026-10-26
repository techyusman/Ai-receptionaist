// Phone numbers as people write and say them, in the restaurant's own country. A New York caller says
// 212 555 0101; a Lahore caller says 0300 1234567. Anything starting with + and a country code works
// everywhere. Stored and compared in E.164 (+12125550101, +923001234567).

/** E.164 from what someone typed, read in `country` (ISO code, "US" or "PK"); null if it isn't a full number. */
export function toE164(raw: string, country = "US"): string | null {
  const typed = raw.trim();
  const digits = typed.replace(/\D/g, "");
  if (!digits) return null;
  if (typed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (typed.startsWith("00")) return toE164(`+${digits.slice(2)}`, country);
  if (country === "PK") {
    // 0300 1234567 (mobile) or 042 3500 0189 (Lahore landline): 11 digits with the trunk 0, 10 without.
    if (digits.length === 11 && digits.startsWith("0")) return `+92${digits.slice(1)}`;
    if (digits.length === 10 && !digits.startsWith("0")) return `+92${digits}`;
    if (digits.length === 12 && digits.startsWith("92")) return `+${digits}`;
    return null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const US = /^\+1(\d{3})(\d{3})(\d{4})$/;
const PK_MOBILE = /^\+92(3\d{2})(\d{3})(\d{4})$/;
const PK_LANDLINE = /^\+92(\d{2})(\d{4})(\d{4})$/;

/** "+1 212 555 0101", "+92 300 123 4567", "+92 42 3500 0189"; anything else as it is. */
export function prettyPhone(e164: string): string {
  const us = US.exec(e164);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  const pk = PK_MOBILE.exec(e164) ?? PK_LANDLINE.exec(e164);
  if (pk) return `+92 ${pk[1]} ${pk[2]} ${pk[3]}`;
  return e164;
}

/** The digits as a person reads the number back, in the groups they'd say: "2 1 2, 5 5 5, 0 1 0 1" or "0 3 0 0, 1 2 3, 4 5 6 7". */
export function readBackDigits(e164: string): string {
  const us = US.exec(e164);
  const pk = PK_MOBILE.exec(e164) ?? PK_LANDLINE.exec(e164);
  const groups = us ? us.slice(1) : pk ? [`0${pk[1]}`, pk[2]!, pk[3]!] : [e164.replace(/\D/g, "")];
  return groups.map((g) => g!.split("").join(" ")).join(", ");
}

/** Last four digits only, for list views (spec §13.14: mask caller phone numbers). */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "Unknown caller";
  return `••• ${e164.slice(-4)}`;
}
