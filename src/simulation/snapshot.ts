import { num } from "../common/utils/serialize";
import type { SimEvent } from "../common/types/sim-event";
import {
  appliancePower,
  estimatedRemainingSeconds,
  formatDuration,
  round,
  type UsageProfile,
} from "./energy";
import type {
  ApplianceLink,
  MeterSnapshot,
  MeterState,
  SnapshotAppliance,
} from "./simulation.types";

/** Builds the public snapshot from a meter row (migrated from buildSnapshot()). */
export function buildSnapshot(
  meter: MeterState,
  appliances: SnapshotAppliance[],
  events: SimEvent[],
): MeterSnapshot {
  const power = num(meter.power_watts);
  const balance = num(meter.balance_kwh);
  return {
    id: meter.id,
    meterNumber: meter.meter_number,
    customerName: meter.customer_name,
    phoneNumber: meter.phone_number,
    balanceKwh: round(balance, 4),
    initialBalance: num(meter.initial_balance),
    totalConsumedKwh: round(num(meter.total_consumed_kwh), 4),
    voltage: num(meter.voltage),
    currentAmps: num(meter.current_amps),
    powerWatts: round(power, 2),
    frequencyHz: num(meter.frequency_hz),
    powerFactor: num(meter.power_factor),
    status: meter.status,
    gsm: meter.gsm,
    signalDbm: meter.signal_dbm,
    tariffPerKwh: num(meter.tariff_per_kwh),
    thresholds: {
      low: num(meter.low_threshold),
      critical: num(meter.critical_threshold),
      urgent: num(meter.urgent_threshold),
    },
    simulationRunning: meter.simulation_running,
    simulationSpeed: meter.simulation_speed,
    simulatedSeconds: num(meter.simulated_seconds),
    estimatedRemaining: formatDuration(estimatedRemainingSeconds(balance, power)),
    appliances,
    events,
    updatedAt: new Date().toISOString(),
  };
}

/** Appliance view without advancing time (migrated from readSnapshot()). */
export function staticApplianceView(
  meter: MeterState,
  links: ApplianceLink[],
): SnapshotAppliance[] {
  return links
    .filter((l) => l.appliance)
    .map((l) => {
      const a = l.appliance!;
      const power = appliancePower(
        {
          ratedPower: num(a.rated_power),
          idlePower: num(a.idle_power),
          powerFactor: num(a.power_factor),
          usageProfile: a.usage_profile as UsageProfile,
          dutyCycle: num(a.duty_cycle),
          cycleSeconds: a.cycle_seconds,
        },
        l.is_on && num(meter.balance_kwh) > 0,
        num(l.cycle_phase),
      );
      return {
        id: l.id,
        applianceId: a.id,
        name: a.name,
        icon: a.icon,
        category: a.category,
        isOn: l.is_on,
        ratedPower: num(a.rated_power),
        currentPower: round(power, 1),
        energyKwh: round(num(l.energy_kwh), 4),
        usageProfile: a.usage_profile,
      };
    });
}
