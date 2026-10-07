import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import { AlertsService } from "../alerts/alerts.service";
import type { AuthUser } from "../common/types/auth-user";
import type { Env } from "../config/env.validation";
import { MeterAccessService } from "../meters/meter-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { MeterEventsService } from "./meter-events.service";
import { computeTick } from "./simulation.engine";
import type { ApplianceLink, MeterSnapshot } from "./simulation.types";
import { buildSnapshot, staticApplianceView } from "./snapshot";

type Tx = Prisma.TransactionClient;

/**
 * Simulation orchestration: loads state, runs the pure engine, persists the
 * result and drives the alert engine. Replaces tickMeter / readSnapshot and the
 * simulation parts of meter.functions.ts.
 *
 * Every write that reads-then-updates the meter balance runs inside a
 * transaction holding a row lock (SELECT ... FOR UPDATE) so concurrent ticks,
 * recharges and resets can never overwrite each other's balance.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly events: MeterEventsService,
    private readonly access: MeterAccessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /* ------------------------------------------------------------------ *
   * Reads
   * ------------------------------------------------------------------ */

  loadLinks(meterId: string, db: Tx | PrismaService = this.prisma): Promise<ApplianceLink[]> {
    return db.meterAppliance.findMany({
      where: { meter_id: meterId },
      include: { appliance: true },
      orderBy: { created_at: "asc" },
    });
  }

  /** Snapshot without advancing the simulation. */
  async readSnapshot(meterId: string): Promise<MeterSnapshot> {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter) throw new NotFoundException("Meter not found");
    const links = await this.loadLinks(meterId);
    return buildSnapshot(meter, staticApplianceView(meter, links), []);
  }

  /**
   * getMeterState: the oldest meter the caller can see (an admin can see every
   * meter, as under RLS), or null when there is none.
   */
  async readCurrentSnapshot(user: AuthUser): Promise<MeterSnapshot | null> {
    const first = await this.prisma.meter.findFirst({
      where: this.access.visibleMetersWhere(user),
      orderBy: { created_at: "asc" },
      select: { id: true },
    });
    return first ? this.readSnapshot(first.id) : null;
  }

  /* ------------------------------------------------------------------ *
   * Tick
   * ------------------------------------------------------------------ */

  /** Runs one simulation tick, persists it, raises alerts and publishes the snapshot. */
  async tick(meterId: string): Promise<MeterSnapshot | null> {
    const readingIntervalMs = this.config.get("METER_READING_INTERVAL_MS", { infer: true });

    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!(await lockMeter(tx, meterId))) return null;
      const meter = await tx.meter.findUniqueOrThrow({ where: { id: meterId } });
      const links = await this.loadLinks(meterId, tx);
      const result = computeTick(meter, links, { now: Date.now(), readingIntervalMs });

      await tx.meter.update({ where: { id: meterId }, data: result.meterUpdate });
      for (const u of result.applianceUpdates) {
        await tx.meterAppliance.update({
          where: { id: u.id },
          data: { cycle_phase: u.cycle_phase, energy_kwh: u.energy_kwh },
        });
      }
      if (result.reading) {
        await tx.meterReading.create({
          data: {
            meter_id: meterId,
            recorded_at: result.meterUpdate.last_tick_at,
            ...result.reading,
          },
        });
      }
      return { meter, result };
    });

    if (!outcome) return null;
    const { meter, result } = outcome;

    if (result.crossing) {
      const alertEvents = await this.alerts.raiseAlert(
        meter,
        result.crossing.kind,
        result.crossing.threshold,
        result.alertContext,
      );
      // snapshot.events is the same array, so the snapshot carries these too.
      result.events.push(...alertEvents);
    }

    this.events.publishSnapshot(result.snapshot);
    return result.snapshot;
  }

  /* ------------------------------------------------------------------ *
   * Controls (controlSimulation / setSimulationSpeed / startDemoMode / forceThreshold)
   * ------------------------------------------------------------------ */

  async start(meterId: string, speed?: number) {
    await this.prisma.meter.update({
      where: { id: meterId },
      data: {
        simulation_running: true,
        last_tick_at: new Date(),
        ...(speed ? { simulation_speed: speed } : {}),
      },
    });
    return this.publishCurrent(meterId);
  }

  async pause(meterId: string) {
    await this.prisma.meter.update({ where: { id: meterId }, data: { simulation_running: false } });
    return this.publishCurrent(meterId);
  }

  /**
   * Reset: balance back to the initial balance, counters and flags cleared,
   * appliances and readings removed, then the default saved rig is replayed.
   */
  async reset(meterId: string) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await lockMeter(tx, meterId))) throw new NotFoundException("Meter not found");
      const meter = await tx.meter.findUniqueOrThrow({
        where: { id: meterId },
        select: { initial_balance: true },
      });
      await tx.meter.update({
        where: { id: meterId },
        data: {
          simulation_running: false,
          balance_kwh: meter.initial_balance ?? 50,
          total_consumed_kwh: 0,
          simulated_seconds: 0,
          power_watts: 0,
          current_amps: 0,
          status: "ACTIVE",
          notified_low: false,
          notified_critical: false,
          notified_urgent: false,
          notified_depleted: false,
          last_tick_at: new Date(),
        },
      });
      await tx.meterAppliance.deleteMany({ where: { meter_id: meterId } });
      await tx.meterReading.deleteMany({ where: { meter_id: meterId } });

      // Replay the saved default layout so a reset returns to a known rig.
      const preset = await tx.meterConfiguration.findFirst({
        where: { meter_id: meterId, is_default: true },
        select: { items: true },
      });
      const items = parseConfigItems(preset?.items);
      if (items.length) {
        await tx.meterAppliance.createMany({
          data: items.map((i) => ({
            meter_id: meterId,
            appliance_id: i.applianceId,
            is_on: i.isOn ?? true,
          })),
        });
      }
    });
    return this.publishCurrent(meterId);
  }

  async setSpeed(meterId: string, speed: number) {
    await this.prisma.meter.update({
      where: { id: meterId },
      data: { simulation_speed: speed, last_tick_at: new Date() },
    });
    await this.publishCurrent(meterId);
    return { ok: true };
  }

  /** Presentation mode: reset to a low starting balance and run at high speed. */
  async startDemo(meterId: string) {
    await this.prisma.meter.update({
      where: { id: meterId },
      data: {
        balance_kwh: 20,
        initial_balance: 20,
        total_consumed_kwh: 0,
        simulated_seconds: 0,
        status: "ACTIVE",
        simulation_speed: 300,
        simulation_running: true,
        notified_low: false,
        notified_critical: false,
        notified_urgent: false,
        notified_depleted: false,
        last_tick_at: new Date(),
      },
    });
    return this.publishCurrent(meterId);
  }

  /**
   * Demo trigger buttons. These force the balance to the requested value and
   * then run the SAME tick + alert engine used by the live simulation — no fake
   * front-end alerts.
   */
  async forceThreshold(meterId: string, balance: number) {
    await this.prisma.meter.update({
      where: { id: meterId },
      data: { balance_kwh: balance, last_tick_at: new Date() },
    });
    const snapshot = await this.tick(meterId);
    if (!snapshot) throw new NotFoundException("Meter not found");
    return snapshot;
  }

  /** Reads the snapshot and pushes it to open streams so every tab updates at once. */
  async publishCurrent(meterId: string): Promise<MeterSnapshot> {
    const snapshot = await this.readSnapshot(meterId);
    this.events.publishSnapshot(snapshot);
    return snapshot;
  }
}

/** Row-locks the meter for the rest of the transaction. Returns false when it does not exist. */
export async function lockMeter(tx: Tx, meterId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM meters WHERE id = ${meterId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export interface ConfigItem {
  applianceId: string;
  isOn?: boolean;
}

/** Saved rigs are stored as JSON; ignore anything that is not a well-formed item. */
export function parseConfigItems(value: Prisma.JsonValue | undefined): ConfigItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const { applianceId, isOn } = item as Record<string, unknown>;
      if (typeof applianceId === "string") {
        return [{ applianceId, ...(typeof isOn === "boolean" ? { isOn } : {}) }];
      }
    }
    return [];
  });
}
