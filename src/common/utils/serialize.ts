import { Prisma } from "@prisma/client";

/**
 * Converts Prisma values into plain JSON-safe values:
 *  - Decimal -> number (PostgREST returned NUMERIC columns as JSON numbers, and the UI relies on it)
 *  - BigInt  -> number (meter_readings.id is a bigserial; values stay far below 2^53)
 * Dates are left alone; JSON.stringify turns them into ISO strings.
 */
export function toJsonSafe<T>(value: T): T {
  return convert(value) as T;
}

function convert(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(convert);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = convert(v);
    return out;
  }
  return value;
}

/** Number() for Prisma Decimal / nullable numeric columns. */
export function num(value: Prisma.Decimal | number | string | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  return Number(value);
}
