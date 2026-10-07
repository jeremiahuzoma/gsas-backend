/**
 * Virtual prepaid meter tick — pure computation, no I/O.
 *
 * This is the body of tickMeter() from src/lib/simulation.server.ts with the
 * database reads and writes lifted out, so the exact same rules can be unit
 * tested and then persisted by SimulationService inside one transaction:
 *
 *  - advance simulated time (real elapsed × speed, capped at 30 real seconds)
 *  - advance appliance duty cycles and per-appliance energy
 *  - compute simulated P, V, I, f, PF
 *  - deduct consumed energy from the balance (never below zero)
 *  - decide whether a reading row is due (METER_READING_INTERVAL_MS)
 *  - detect threshold crossings idempotently and set the notified_* flags
 */
import { num } from "../common/utils/serialize";
import { simEvent, type SimEvent } from "../common/types/sim-event";
import {
  aggregatePowerFactor,
  appliancePower,
  calculateCurrent,
  calculateEnergyKwh,
  detectThresholdCrossing,
  round,
  simulateFrequency,
  simulateVoltage,
  statusForBalance,
  type AlertKind,
  type ThresholdConfig,
  type UsageProfile,
} from "./energy";
import { buildSnapshot } from "./snapshot";
import type {
  ApplianceLink,
  MeterRow,
  MeterSnapshot,
  MeterState,
  SnapshotAppliance,
} from "./simulation.types";

/** Never fast-forward more than 30 real seconds per tick. */
export const TICK_CAP_SECONDS = 30;

export type MeterStatusValue = "ACTIVE" | "LOW" | "CRITICAL" | "URGENT" | "DEPLETED";

export interface MeterTickUpdate {
  balance_kwh: number;
  total_consumed_kwh: number;
  voltage: number;
  current_amps: number;
  power_watts: number;
  frequency_hz: number;
  power_factor: number;
  status: MeterStatusValue;
  simulated_seconds: number;
  last_tick_at: Date;
  last_reading_at?: Date;
  notified_low?: boolean;
  notified_critical?: boolean;
  notified_urgent?: boolean;
  notified_depleted?: boolean;
}

export interface ReadingInsert {
  voltage: number;
  current_amps: number;
  power_watts: number;
  frequency_hz: number;
  power_factor: number;
  energy_kwh: number;
  balance_kwh: number;
}

export interface TickResult {
  meterUpdate: MeterTickUpdate;
  applianceUpdates: Array<{ id: string; cycle_phase: number; energy_kwh: number }>;
  reading: ReadingInsert | null;
  crossing: { kind: AlertKind; threshold: number } | null;
  /** Inputs the alert engine needs when `crossing` is set. */
  alertContext: { totalPower: number; balance: number };
  /** Events produced by the tick itself (alert/SMS events are appended later). */
  events: SimEvent[];
  /** Snapshot after the tick, built from the merged meter state. */
  snapshot: MeterSnapshot;
}

export interface TickOptions {
  now: number;
  readingIntervalMs: number;
}

export function thresholdsOf(meter: MeterState): ThresholdConfig {
  return {
    low: num(meter.low_threshold),
    critical: num(meter.critical_threshold),
    urgent: num(meter.urgent_threshold),
  };
}

export function flagUpdateFor(kind: AlertKind) {
  switch (kind) {
    case "LOW_BALANCE":
      return { notified_low: true };
    case "CRITICAL_BALANCE":
      return { notified_critical: true, notified_low: true };
    case "URGENT_BALANCE":
      return { notified_urgent: true, notified_critical: true, notified_low: true };
    case "METER_DEPLETED":
      return {
        notified_depleted: true,
        notified_urgent: true,
        notified_critical: true,
        notified_low: true,
      };
  }
}

export function computeTick(
  meter: MeterRow,
  links: ApplianceLink[],
  opts: TickOptions,
): TickResult {
  const { now } = opts;
  const events: SimEvent[] = [];

  const lastTick = meter.last_tick_at ? meter.last_tick_at.getTime() : now;
  const realElapsed = meter.simulation_running
    ? Math.min(Math.max((now - lastTick) / 1000, 0), TICK_CAP_SECONDS)
    : 0;
  const simElapsed = realElapsed * meter.simulation_speed;

  let balance = num(meter.balance_kwh);
  const depleted = balance <= 0;

  // --- per-appliance power + energy ---
  const loads: Array<{ power: number; powerFactor: number }> = [];
  const applianceUpdates: TickResult["applianceUpdates"] = [];
  const applianceView: SnapshotAppliance[] = [];

  for (const link of links) {
    const a = link.appliance;
    if (!a) continue;
    const phase = num(link.cycle_phase) + simElapsed;
    const spec = {
      ratedPower: num(a.rated_power),
      idlePower: num(a.idle_power),
      powerFactor: num(a.power_factor),
      usageProfile: a.usage_profile as UsageProfile,
      dutyCycle: num(a.duty_cycle),
      cycleSeconds: a.cycle_seconds,
    };
    const isOn = link.is_on && !depleted;
    const power = appliancePower(spec, isOn, phase);
    const energy = calculateEnergyKwh(power, simElapsed);
    const applianceEnergy = num(link.energy_kwh) + energy;

    if (power > 0) loads.push({ power, powerFactor: spec.powerFactor });
    if (simElapsed > 0) {
      applianceUpdates.push({
        id: link.id,
        cycle_phase: round(phase % Math.max(1, spec.cycleSeconds), 2),
        energy_kwh: round(applianceEnergy, 5),
      });
    }
    applianceView.push({
      id: link.id,
      applianceId: a.id,
      name: a.name,
      icon: a.icon,
      category: a.category,
      isOn: link.is_on,
      ratedPower: spec.ratedPower,
      currentPower: round(power, 1),
      energyKwh: round(applianceEnergy, 4),
      usageProfile: a.usage_profile,
    });
  }

  const totalPower = loads.reduce((s, l) => s + l.power, 0);
  const powerFactor = aggregatePowerFactor(loads);
  const voltage = simulateVoltage(230, totalPower / 1000);
  const frequency = simulateFrequency();
  const current = calculateCurrent(totalPower, voltage, powerFactor);

  const energyConsumed = calculateEnergyKwh(totalPower, simElapsed);
  const previousBalance = balance;
  balance = Math.max(0, balance - energyConsumed);
  const actuallyConsumed = previousBalance - balance;

  const thresholds = thresholdsOf(meter);
  const status = statusForBalance(balance, thresholds);

  const shouldPersistReading =
    !meter.last_reading_at || now - meter.last_reading_at.getTime() >= opts.readingIntervalMs;

  const meterUpdate: MeterTickUpdate = {
    balance_kwh: round(balance, 4),
    total_consumed_kwh: round(num(meter.total_consumed_kwh) + actuallyConsumed, 4),
    voltage,
    current_amps: current,
    power_watts: round(totalPower, 2),
    frequency_hz: frequency,
    power_factor: round(powerFactor, 3),
    status,
    simulated_seconds: round(num(meter.simulated_seconds) + simElapsed, 2),
    last_tick_at: new Date(now),
  };

  if (balance <= 0 && previousBalance > 0) {
    events.push(simEvent("error", "Meter DEPLETED - supply interrupted", now));
  }

  // --- threshold detection (idempotent) ---
  const crossing = detectThresholdCrossing(balance, thresholds, {
    notifiedLow: meter.notified_low,
    notifiedCritical: meter.notified_critical,
    notifiedUrgent: meter.notified_urgent,
    notifiedDepleted: meter.notified_depleted,
  });
  if (crossing) Object.assign(meterUpdate, flagUpdateFor(crossing.kind));

  let reading: ReadingInsert | null = null;
  if (shouldPersistReading && meter.simulation_running) {
    reading = {
      voltage,
      current_amps: current,
      power_watts: round(totalPower, 2),
      frequency_hz: frequency,
      power_factor: round(powerFactor, 3),
      energy_kwh: round(actuallyConsumed, 5),
      balance_kwh: round(balance, 4),
    };
    meterUpdate.last_reading_at = new Date(now);
  }

  const merged: MeterState = { ...meter, ...meterUpdate };
  return {
    meterUpdate,
    applianceUpdates,
    reading,
    crossing,
    alertContext: { totalPower, balance },
    events,
    snapshot: buildSnapshot(merged, applianceView, events),
  };
}
