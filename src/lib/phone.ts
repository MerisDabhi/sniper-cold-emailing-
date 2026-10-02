/** Phone helpers for WhatsApp leads. Numbers are stored as digits only, with country code. */

/**
 * Normalize a phone number from a sheet to international digits (e.g. "919876543210").
 * `countryCode` (e.g. "91") is added to numbers that don't already include one.
 * Returns null when it can't be a valid number.
 */
export function normalizePhone(raw: string, countryCode = ""): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const hadPlus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (!hadPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hadPlus) {
    const cc = countryCode.replace(/\D/g, "");
    if (cc && !digits.startsWith(cc)) digits = cc + digits.replace(/^0+/, "");
    else if (cc && digits.startsWith(cc) && digits.length <= 10) digits = cc + digits; // local number that happens to start with the code
    // No "+", no country code set and too short to include one: we can't know the country, so don't guess.
    else if (!cc && digits.length <= 10) return null;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export const formatPhone = (digits?: string) => (digits ? `+${digits}` : "");

/** Key used for duplicate protection and unsubscribes: emails as-is, phones as "wa:<digits>". */
export function contactKey(lead: { email?: string; phone?: string }) {
  return lead.phone ? `wa:${lead.phone}` : (lead.email || "").trim().toLowerCase();
}

/** Human-readable form of a contact key. */
export function displayContact(key: string) {
  return key.startsWith("wa:") ? `+${key.slice(3)}` : key;
}
