import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Length mismatch returns false without
 * comparing contents (same contract as the original helper).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return nodeTimingSafeEqual(left, right);
}
