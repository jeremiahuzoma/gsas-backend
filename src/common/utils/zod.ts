import { z } from "zod";

/** Same uuid rule the original server functions used (z.string().uuid()). */
export const uuid = z.string().uuid();

/** Query-string integer with bounds and default (query params arrive as strings). */
export const queryInt = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
