import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Same rules as the original updateMeterSettings validator. */
export const updateMeterSettingsSchema = z.object({
  phoneNumber: z.string().min(7).max(20).optional(),
  customerName: z.string().min(2).max(80).optional(),
  tariff: z.number().min(1).max(100000).optional(),
  low: z.number().min(0).max(10000).optional(),
  critical: z.number().min(0).max(10000).optional(),
  urgent: z.number().min(0).max(10000).optional(),
  gsm: z.enum(["CONNECTED", "WEAK", "DISCONNECTED"]).optional(),
  initialBalance: z.number().min(0).max(100000).optional(),
});

export class UpdateMeterSettingsDto extends createZodDto(updateMeterSettingsSchema) {}

/** Simulated signal strength for each GSM state (same values as the original). */
export function signalFor(gsm: "CONNECTED" | "WEAK" | "DISCONNECTED"): number {
  return gsm === "CONNECTED" ? -68 : gsm === "WEAK" ? -101 : -120;
}
