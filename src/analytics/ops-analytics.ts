/**
 * Pure aggregation for the operations analytics page (migrated from
 * buildOpsAnalytics() in src/lib/analytics.server.ts). Kept free of I/O so the
 * maths is unit-testable; AnalyticsService feeds it rows from Prisma.
 */
import { bucketKey } from "./time-range";

export interface OpsAnalytics {
  rangeDays: number;
  buckets: {
    label: string;
    energy: number;
    cost: number;
    avgPower: number;
    peakPower: number;
    alerts: number;
  }[];
  consumption: {
    totalEnergy: number;
    totalCost: number;
    avgPower: number;
    peakPower: number;
    readings: number;
    tariff: number;
  };
  crossings: { type: string; count: number }[];
  crossingsBySeverity: { severity: string; count: number }[];
  sms: {
    total: number;
    delivered: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    avgAttempts: number;
    maxAttempts: number;
    retried: number;
  };
  ussd: { total: number; completed: number; active: number; completionRate: number };
  retryTrend: { label: string; avgAttempts: number; failed: number; delivered: number }[];
}

export interface OpsInput {
  days: number;
  tariff: number;
  readings: Array<{ recorded_at: Date; power_watts: number; energy_kwh: number }>;
  alerts: Array<{ created_at: Date; type: string; severity: string }>;
  sms: Array<{ created_at: Date; status: string; attempts: number | null }>;
  ussd: Array<{ started_at: Date; status: string }>;
}

export function emptyOpsAnalytics(days: number, tariff: number): OpsAnalytics {
  return {
    rangeDays: days,
    buckets: [],
    consumption: { totalEnergy: 0, totalCost: 0, avgPower: 0, peakPower: 0, readings: 0, tariff },
    crossings: [],
    crossingsBySeverity: [],
    sms: {
      total: 0,
      delivered: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      successRate: 0,
      avgAttempts: 0,
      maxAttempts: 0,
      retried: 0,
    },
    ussd: { total: 0, completed: 0, active: 0, completionRate: 0 },
    retryTrend: [],
  };
}

export function aggregateOps({
  days,
  tariff,
  readings,
  alerts,
  sms,
  ussd,
}: OpsInput): OpsAnalytics {
  // --- consumption trend, bucketed by hour (1 day) or by day (longer ranges)
  const buckets = new Map<
    string,
    { energy: number; powerSum: number; count: number; peak: number; alerts: number }
  >();
  const ensure = (key: string) => {
    let b = buckets.get(key);
    if (!b) {
      b = { energy: 0, powerSum: 0, count: 0, peak: 0, alerts: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  let totalEnergy = 0;
  let powerSum = 0;
  let peakPower = 0;
  for (const r of readings) {
    const b = ensure(bucketKey(r.recorded_at, days));
    b.energy += r.energy_kwh;
    b.powerSum += r.power_watts;
    b.count += 1;
    b.peak = Math.max(b.peak, r.power_watts);
    totalEnergy += r.energy_kwh;
    powerSum += r.power_watts;
    peakPower = Math.max(peakPower, r.power_watts);
  }

  // --- threshold crossings
  const byType = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  for (const a of alerts) {
    byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
    bySeverity.set(a.severity, (bySeverity.get(a.severity) ?? 0) + 1);
    ensure(bucketKey(a.created_at, days)).alerts += 1;
  }

  // --- SMS delivery + retry pressure
  const smsCounts = { delivered: 0, sent: 0, failed: 0, pending: 0 };
  let attemptSum = 0;
  let maxAttempts = 0;
  let retried = 0;
  const retryBuckets = new Map<
    string,
    { attemptSum: number; count: number; failed: number; delivered: number }
  >();
  for (const s of sms) {
    const status = s.status.toUpperCase();
    if (status === "DELIVERED") smsCounts.delivered += 1;
    else if (status === "SENT") smsCounts.sent += 1;
    else if (status === "FAILED") smsCounts.failed += 1;
    else smsCounts.pending += 1;

    const attempts = s.attempts ?? 0;
    attemptSum += attempts;
    maxAttempts = Math.max(maxAttempts, attempts);
    if (attempts > 1) retried += 1;

    const key = bucketKey(s.created_at, days);
    let rb = retryBuckets.get(key);
    if (!rb) {
      rb = { attemptSum: 0, count: 0, failed: 0, delivered: 0 };
      retryBuckets.set(key, rb);
    }
    rb.attemptSum += attempts;
    rb.count += 1;
    if (status === "FAILED") rb.failed += 1;
    if (status === "DELIVERED") rb.delivered += 1;
  }
  const smsTotal = sms.length;
  const successful = smsCounts.delivered + smsCounts.sent;

  // --- USSD sessions
  const ussdCompleted = ussd.filter((s) => s.status.toUpperCase() !== "ACTIVE").length;

  const sortedKeys = [...buckets.keys()].sort();

  return {
    rangeDays: days,
    buckets: sortedKeys.map((label) => {
      const b = buckets.get(label)!;
      return {
        label,
        energy: Number(b.energy.toFixed(4)),
        cost: Number((b.energy * tariff).toFixed(2)),
        avgPower: b.count ? Number((b.powerSum / b.count).toFixed(1)) : 0,
        peakPower: Number(b.peak.toFixed(1)),
        alerts: b.alerts,
      };
    }),
    consumption: {
      totalEnergy,
      totalCost: totalEnergy * tariff,
      avgPower: readings.length ? powerSum / readings.length : 0,
      peakPower,
      readings: readings.length,
      tariff,
    },
    crossings: [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    crossingsBySeverity: [...bySeverity.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    sms: {
      total: smsTotal,
      ...smsCounts,
      successRate: smsTotal ? (successful / smsTotal) * 100 : 0,
      avgAttempts: smsTotal ? attemptSum / smsTotal : 0,
      maxAttempts,
      retried,
    },
    ussd: {
      total: ussd.length,
      completed: ussdCompleted,
      active: ussd.length - ussdCompleted,
      completionRate: ussd.length ? (ussdCompleted / ussd.length) * 100 : 0,
    },
    retryTrend: [...retryBuckets.keys()].sort().map((label) => {
      const rb = retryBuckets.get(label)!;
      return {
        label,
        avgAttempts: rb.count ? Number((rb.attemptSum / rb.count).toFixed(2)) : 0,
        failed: rb.failed,
        delivered: rb.delivered,
      };
    }),
  };
}
