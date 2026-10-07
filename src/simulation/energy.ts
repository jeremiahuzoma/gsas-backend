// Migrated verbatim from src/lib/energy.ts (original TanStack Start app).
/**
 * Pure electrical / energy calculation helpers.
 *
 * These functions are deliberately free of I/O so they can be reused by the
 * server-side simulation engine, the USSD service and unit tests.
 *
 * NOTE: all values produced here are SIMULATED electrical values. They model
 * the behaviour of a prepaid energy meter and are not measurements taken from
 * a physical utility meter.
 */

export const NOMINAL_VOLTAGE = 230;
export const NOMINAL_FREQUENCY = 50;

export type UsageProfile = "CONSTANT" | "CYCLIC" | "INTERMITTENT";

export type MeterVisualState =
  "NORMAL" | "INFORMATION" | "WARNING" | "LOW" | "CRITICAL" | "URGENT" | "DEPLETED";

export interface ApplianceSpec {
  ratedPower: number;
  idlePower: number;
  powerFactor: number;
  usageProfile: UsageProfile;
  dutyCycle: number;
  cycleSeconds: number;
}

/** Instantaneous power (W) of one appliance given its position in its cycle. */
export function appliancePower(
  spec: ApplianceSpec,
  isOn: boolean,
  cyclePhaseSeconds: number,
): number {
  if (!isOn) return 0;
  switch (spec.usageProfile) {
    case "CONSTANT":
      return spec.ratedPower;
    case "CYCLIC":
    case "INTERMITTENT": {
      const cycle = Math.max(1, spec.cycleSeconds);
      const onWindow = cycle * clamp(spec.dutyCycle, 0, 1);
      const phase = ((cyclePhaseSeconds % cycle) + cycle) % cycle;
      return phase < onWindow ? spec.ratedPower : spec.idlePower;
    }
    default:
      return spec.ratedPower;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Aggregate power factor weighted by each appliance's active power. */
export function aggregatePowerFactor(loads: Array<{ power: number; powerFactor: number }>): number {
  const total = loads.reduce((sum, l) => sum + l.power, 0);
  if (total <= 0) return 0.95;
  const weighted = loads.reduce((sum, l) => sum + l.power * l.powerFactor, 0);
  return clamp(weighted / total, 0.5, 1);
}

/** Simulated supply voltage with small realistic fluctuation around nominal. */
export function simulateVoltage(nominal = NOMINAL_VOLTAGE, loadKw = 0): number {
  const sag = clamp(loadKw * 0.35, 0, 4); // heavier load pulls voltage down a little
  const noise = (Math.random() - 0.5) * 1.6;
  return round(clamp(nominal - sag + noise, nominal - 12, nominal + 8), 2);
}

/** Simulated grid frequency with very small fluctuation. */
export function simulateFrequency(nominal = NOMINAL_FREQUENCY): number {
  return round(nominal + (Math.random() - 0.5) * 0.08, 3);
}

/** I = P / (V x PF) */
export function calculateCurrent(powerWatts: number, voltage: number, powerFactor: number): number {
  if (powerWatts <= 0 || voltage <= 0 || powerFactor <= 0) return 0;
  return round(powerWatts / (voltage * powerFactor), 3);
}

/** Energy (kWh) = Power (kW) x Time (h) */
export function calculateEnergyKwh(powerWatts: number, seconds: number): number {
  return (powerWatts / 1000) * (seconds / 3600);
}

export function estimatedRemainingSeconds(balanceKwh: number, powerWatts: number): number | null {
  if (powerWatts <= 0) return null;
  return (balanceKwh / (powerWatts / 1000)) * 3600;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "\u221E";
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 99) return "99h+";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Visual/accessibility state derived from remaining balance. */
export function visualState(balanceKwh: number): MeterVisualState {
  if (balanceKwh <= 0) return "DEPLETED";
  if (balanceKwh < 5) return "URGENT";
  if (balanceKwh < 15) return "CRITICAL";
  if (balanceKwh < 20) return "LOW";
  if (balanceKwh < 30) return "WARNING";
  if (balanceKwh < 50) return "INFORMATION";
  return "NORMAL";
}

export interface ThresholdConfig {
  low: number;
  critical: number;
  urgent: number;
}

export interface ThresholdFlags {
  notifiedLow: boolean;
  notifiedCritical: boolean;
  notifiedUrgent: boolean;
  notifiedDepleted: boolean;
}

export type AlertKind = "LOW_BALANCE" | "CRITICAL_BALANCE" | "URGENT_BALANCE" | "METER_DEPLETED";

/**
 * Idempotent threshold detection: returns the alert that should fire for the
 * current balance, or null when the balance has not newly crossed a threshold.
 * Flags are reset on recharge so the same threshold can fire again later.
 */
export function detectThresholdCrossing(
  balanceKwh: number,
  cfg: ThresholdConfig,
  flags: ThresholdFlags,
): { kind: AlertKind; threshold: number } | null {
  if (balanceKwh <= 0) {
    return flags.notifiedDepleted ? null : { kind: "METER_DEPLETED", threshold: 0 };
  }
  if (balanceKwh <= cfg.urgent && !flags.notifiedUrgent) {
    return { kind: "URGENT_BALANCE", threshold: cfg.urgent };
  }
  if (balanceKwh <= cfg.critical && !flags.notifiedCritical) {
    return { kind: "CRITICAL_BALANCE", threshold: cfg.critical };
  }
  if (balanceKwh <= cfg.low && !flags.notifiedLow) {
    return { kind: "LOW_BALANCE", threshold: cfg.low };
  }
  return null;
}

/** Flags that should be cleared after a recharge, based on the new balance. */
export function resetFlagsForBalance(balanceKwh: number, cfg: ThresholdConfig): ThresholdFlags {
  return {
    notifiedLow: balanceKwh <= cfg.low,
    notifiedCritical: balanceKwh <= cfg.critical,
    notifiedUrgent: balanceKwh <= cfg.urgent,
    notifiedDepleted: balanceKwh <= 0,
  };
}

export function statusForBalance(
  balanceKwh: number,
  cfg: ThresholdConfig,
): "ACTIVE" | "LOW" | "CRITICAL" | "URGENT" | "DEPLETED" {
  if (balanceKwh <= 0) return "DEPLETED";
  if (balanceKwh <= cfg.urgent) return "URGENT";
  if (balanceKwh <= cfg.critical) return "CRITICAL";
  if (balanceKwh <= cfg.low) return "LOW";
  return "ACTIVE";
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

export function formatNaira(amount: number): string {
  return `\u20A6${amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}
