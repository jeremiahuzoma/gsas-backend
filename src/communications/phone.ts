/**
 * Normalises Nigerian numbers to E.164 (+234...).
 * Migrated verbatim from normalisePhone() in src/lib/africastalking.server.ts.
 */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;
  if (/^0\d{10}$/.test(trimmed)) return `+234${trimmed.slice(1)}`;
  if (/^234\d{10}$/.test(trimmed)) return `+${trimmed}`;
  return null;
}

export const INVALID_PHONE_MESSAGE = "Enter a valid phone number, e.g. 08012345678";
