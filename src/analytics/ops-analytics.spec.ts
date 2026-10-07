import { aggregateOps, emptyOpsAnalytics } from "./ops-analytics";

const at = (iso: string) => new Date(iso);

describe("aggregateOps", () => {
  it("returns zeros for an empty range", () => {
    expect(emptyOpsAnalytics(7, 100).consumption).toEqual({
      totalEnergy: 0,
      totalCost: 0,
      avgPower: 0,
      peakPower: 0,
      readings: 0,
      tariff: 100,
    });
  });

  it("totals energy, cost, average and peak load per day bucket", () => {
    const r = aggregateOps({
      days: 7,
      tariff: 100,
      readings: [
        { recorded_at: at("2026-10-06T10:00:00Z"), power_watts: 1000, energy_kwh: 0.5 },
        { recorded_at: at("2026-10-06T11:00:00Z"), power_watts: 3000, energy_kwh: 1.5 },
        { recorded_at: at("2026-10-07T09:00:00Z"), power_watts: 500, energy_kwh: 0.25 },
      ],
      alerts: [{ created_at: at("2026-10-06T11:00:00Z"), type: "LOW_BALANCE", severity: "LOW" }],
      sms: [],
      ussd: [],
    });
    expect(r.consumption).toMatchObject({
      totalEnergy: 2.25,
      totalCost: 225,
      peakPower: 3000,
      readings: 3,
    });
    expect(r.consumption.avgPower).toBeCloseTo(1500);
    expect(r.buckets).toEqual([
      { label: "2026-10-06", energy: 2, cost: 200, avgPower: 2000, peakPower: 3000, alerts: 1 },
      { label: "2026-10-07", energy: 0.25, cost: 25, avgPower: 500, peakPower: 500, alerts: 0 },
    ]);
    expect(r.crossings).toEqual([{ type: "LOW_BALANCE", count: 1 }]);
  });

  it("computes SMS success rate, retry pressure and USSD completion", () => {
    const d = at("2026-10-07T09:00:00Z");
    const r = aggregateOps({
      days: 7,
      tariff: 100,
      readings: [],
      alerts: [],
      sms: [
        { created_at: d, status: "DELIVERED", attempts: 1 },
        { created_at: d, status: "SENT", attempts: 2 },
        { created_at: d, status: "FAILED", attempts: 5 },
        { created_at: d, status: "RETRY_SCHEDULED", attempts: 2 },
      ],
      ussd: [
        { started_at: d, status: "COMPLETED" },
        { started_at: d, status: "ACTIVE" },
      ],
    });
    expect(r.sms).toEqual({
      total: 4,
      delivered: 1,
      sent: 1,
      failed: 1,
      pending: 1,
      successRate: 50,
      avgAttempts: 2.5,
      maxAttempts: 5,
      retried: 3,
    });
    expect(r.retryTrend).toEqual([
      { label: "2026-10-07", avgAttempts: 2.5, failed: 1, delivered: 1 },
    ]);
    expect(r.ussd).toEqual({ total: 2, completed: 1, active: 1, completionRate: 50 });
  });
});
