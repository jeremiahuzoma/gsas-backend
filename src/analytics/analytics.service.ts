import { Injectable } from "@nestjs/common";

import type { AuthUser } from "../common/types/auth-user";
import { num } from "../common/utils/serialize";
import { MeterAccessService } from "../meters/meter-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { aggregateOps, emptyOpsAnalytics, type OpsAnalytics } from "./ops-analytics";
import { sinceDate } from "./time-range";

/** Readings history, per-meter analytics and the operations dashboard. */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeterAccessService,
  ) {}

  /** getReadings: newest first, at most 1000 rows. */
  readings(meterId: string, days: number) {
    return this.prisma.meterReading.findMany({
      where: { meter_id: meterId, recorded_at: { gte: sinceDate(days) } },
      orderBy: { recorded_at: "desc" },
      take: 1000,
    });
  }

  /** getAnalytics: per-meter KPIs, time series, per-appliance and per-day energy. */
  async meterAnalytics(meterId: string, days: number) {
    const [meter, rows, applianceRows] = await Promise.all([
      this.prisma.meter.findUnique({
        where: { id: meterId },
        select: { tariff_per_kwh: true, balance_kwh: true, power_watts: true },
      }),
      this.prisma.meterReading.findMany({
        where: { meter_id: meterId, recorded_at: { gte: sinceDate(days) } },
        select: {
          recorded_at: true,
          power_watts: true,
          voltage: true,
          current_amps: true,
          energy_kwh: true,
          balance_kwh: true,
        },
        orderBy: { recorded_at: "asc" },
        take: 1000,
      }),
      this.prisma.meterAppliance.findMany({
        where: { meter_id: meterId },
        select: { energy_kwh: true, appliance: { select: { name: true } } },
      }),
    ]);

    const readings = rows.map((r) => ({
      recorded_at: r.recorded_at,
      power: num(r.power_watts),
      voltage: num(r.voltage),
      current: num(r.current_amps),
      energy: num(r.energy_kwh),
      balance: num(r.balance_kwh),
    }));
    const tariff = meter ? num(meter.tariff_per_kwh) : 100;
    const totalEnergy = readings.reduce((s, r) => s + r.energy, 0);
    const avgLoad = readings.length
      ? readings.reduce((s, r) => s + r.power, 0) / readings.length
      : 0;
    const peakLoad = readings.reduce((m, r) => Math.max(m, r.power), 0);
    const avgVoltage = readings.length
      ? readings.reduce((s, r) => s + r.voltage, 0) / readings.length
      : 0;

    const byAppliance = applianceRows
      .map((r) => ({ name: r.appliance?.name ?? "Unknown", energy: num(r.energy_kwh) }))
      .filter((r) => r.energy > 0)
      .sort((a, b) => b.energy - a.energy);

    const dailyMap = new Map<string, number>();
    for (const r of readings) {
      const key = r.recorded_at.toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + r.energy);
    }

    return {
      tariff,
      totalEnergy,
      avgLoad,
      peakLoad,
      avgVoltage,
      estimatedCost: totalEnergy * tariff,
      series: readings.map((r) => ({
        t: r.recorded_at.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        power: r.power,
        voltage: r.voltage,
        current: r.current,
        energy: r.energy,
        balance: r.balance,
      })),
      byAppliance,
      daily: [...dailyMap.entries()].map(([day, energy]) => ({ day, energy })),
    };
  }

  /**
   * Operations analytics (getOpsAnalytics). Scoped to the caller's meters — or
   * every meter for an admin — exactly as the RLS-scoped original was.
   */
  async ops(user: AuthUser, days: number, meterId?: string): Promise<OpsAnalytics> {
    const since = sinceDate(days);
    const meters = await this.prisma.meter.findMany({
      where: { ...this.access.visibleMetersWhere(user), ...(meterId ? { id: meterId } : {}) },
      select: { id: true, tariff_per_kwh: true },
      orderBy: { created_at: "asc" },
    });
    const meterIds = meters.map((m) => m.id);
    const tariff = meters[0] ? num(meters[0].tariff_per_kwh) : 100;
    if (meterIds.length === 0) return emptyOpsAnalytics(days, tariff);

    const [readings, alerts, sms, ussd] = await Promise.all([
      this.prisma.meterReading.findMany({
        where: { meter_id: { in: meterIds }, recorded_at: { gte: since } },
        select: { recorded_at: true, power_watts: true, energy_kwh: true },
        orderBy: { recorded_at: "asc" },
        take: 5000,
      }),
      this.prisma.alert.findMany({
        where: {
          meter_id: { in: meterIds },
          created_at: { gte: since },
          ...this.access.ownedRowsWhere(user),
        },
        select: { created_at: true, type: true, severity: true },
        take: 2000,
      }),
      this.prisma.smsLog.findMany({
        where: {
          meter_id: { in: meterIds },
          created_at: { gte: since },
          ...this.access.ownedRowsWhere(user),
        },
        select: { created_at: true, status: true, attempts: true },
        take: 2000,
      }),
      this.prisma.ussdSession.findMany({
        where: { started_at: { gte: since }, ...this.access.ownedRowsWhere(user) },
        select: { started_at: true, status: true },
        take: 2000,
      }),
    ]);

    return aggregateOps({
      days,
      tariff,
      readings: readings.map((r) => ({
        recorded_at: r.recorded_at,
        power_watts: num(r.power_watts),
        energy_kwh: num(r.energy_kwh),
      })),
      alerts,
      sms,
      ussd,
    });
  }
}
