import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Same rules as the original meter.functions validators. */
export const configItemsSchema = z
  .array(z.object({ applianceId: z.string().uuid(), isOn: z.boolean().default(true) }))
  .max(40);

export class AddApplianceDto extends createZodDto(z.object({ applianceId: z.string().uuid() })) {}
export class SetApplianceStateDto extends createZodDto(z.object({ isOn: z.boolean() })) {}
export class ReplaceAppliancesDto extends createZodDto(z.object({ items: configItemsSchema })) {}

export class SaveConfigurationDto extends createZodDto(
  z.object({
    name: z.string().min(2).max(60),
    makeDefault: z.boolean().optional(),
    items: configItemsSchema.optional(),
  }),
) {}
