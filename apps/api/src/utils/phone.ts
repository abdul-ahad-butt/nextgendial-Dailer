/**
 * apps/api/src/utils/phone.ts
 *
 * Strict E.164 phone number sanitizer & validator.
 * Eliminates "Invalid number" SIP gateway rejection errors.
 */

export function normalizeToE164(raw: string, defaultCountry = '+1'): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  if (cleaned.length === 10) {
    const prefix = defaultCountry.startsWith('+') ? defaultCountry : `+${defaultCountry}`;
    return `${prefix}${cleaned}`;
  }
  
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  return `+${cleaned}`;
}

export function isValidE164(phone: string): boolean {
  if (!phone) return false;
  // Standard E.164 pattern: + followed by 7 to 15 digits
  return /^\+[1-9]\d{6,14}$/.test(phone);
}
