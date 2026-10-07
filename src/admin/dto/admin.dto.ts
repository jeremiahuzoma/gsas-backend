import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import { queryInt } from "../../common/utils/zod";

/** Same rules as the original adminUpdateMeter validator. */
export class AdminUpdateMeterDto extends createZodDto(
  z.object({
    customerName: z.string().min(2).max(80).optional(),
    phoneNumber: z.string().min(7).max(20).optional(),
    tariff: z.number().min(1).max(100000).optional(),
    low: z.number().min(0).max(10000).optional(),
    critical: z.number().min(0).max(10000).optional(),
    urgent: z.number().min(0).max(10000).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    gsm: z.enum(["CONNECTED", "WEAK", "DISCONNECTED"]).optional(),
  }),
) {}

export class SaveTemplateDto extends createZodDto(
  z.object({
    key: z
      .string()
      .min(3)
      .max(48)
      .regex(/^[A-Z0-9_]+$/, "Use upper-case letters, digits and underscores"),
    body: z.string().min(5).max(600),
  }),
) {}

export const applianceSchema = z.object({
  name: z.string().min(2).max(60),
  category: z.string().min(2).max(40),
  icon: z.string().min(1).max(40),
  ratedPower: z.number().min(0).max(50000),
  idlePower: z.number().min(0).max(5000),
  usageProfile: z.enum(["CONSTANT", "CYCLIC", "INTERMITTENT"]),
  dutyCycle: z.number().min(0).max(1),
  cycleSeconds: z.number().int().min(10).max(86400),
  powerFactor: z.number().min(0.1).max(1),
});

export class SaveApplianceDto extends createZodDto(applianceSchema) {}

export class SmsLogsQueryDto extends createZodDto(z.object({ limit: queryInt(1, 200, 60) })) {}

export class RetrySmsDto extends createZodDto(z.object({ logId: z.string().uuid().optional() })) {}
