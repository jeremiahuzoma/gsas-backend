import type { Appliance, Meter, MeterAppliance, Prisma } from "@prisma/client";

import type { SimEvent } from "../common/types/sim-event";

export type { SimEvent };

/** Live view of one meter, pushed over SSE as `meter.updated` (same shape as before). */
export interface MeterSnapshot {
  id: string;
  meterNumber: string;
  customerName: string;
  phoneNumber: string | null;
  balanceKwh: number;
  initialBalance: number;
  totalConsumedKwh: number;
  voltage: number;
  currentAmps: number;
  powerWatts: number;
  frequencyHz: number;
  powerFactor: number;
  status: string;
  gsm: string;
  signalDbm: number;
  tariffPerKwh: number;
  thresholds: { low: number; critical: number; urgent: number };
  simulationRunning: boolean;
  simulationSpeed: number;
  simulatedSeconds: number;
  estimatedRemaining: string;
  appliances: SnapshotAppliance[];
  events: SimEvent[];
  updatedAt: string;
}

export interface SnapshotAppliance {
  id: string;
  applianceId: string;
  name: string;
  icon: string;
  category: string;
  isOn: boolean;
  ratedPower: number;
  currentPower: number;
  energyKwh: number;
  usageProfile: string;
}

export type MeterRow = Meter;

/** A meter row whose numeric columns may already have been converted to numbers. */
export type MeterState = {
  [K in keyof Meter]: Meter[K] extends Prisma.Decimal ? Prisma.Decimal | number : Meter[K];
};
export type ApplianceLink = MeterAppliance & { appliance: Appliance | null };
