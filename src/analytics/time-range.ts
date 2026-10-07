/**
 * Start of the reporting window. "1 day" means since local midnight; longer
 * ranges are rolling windows (same rule as the original sinceIso helpers).
 */
export function sinceDate(days: number, now = new Date()): Date {
  if (days <= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getTime() - days * 86_400_000);
}

/** Hour bucket for "today", calendar day otherwise. */
export function bucketKey(at: Date, days: number): string {
  if (days <= 1) return `${String(at.getHours()).padStart(2, "0")}:00`;
  return at.toISOString().slice(0, 10);
}
