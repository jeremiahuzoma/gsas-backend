import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Same rule as the original rechargeMeter validator: positive, at most 5000 kWh. */
export class RechargeDto extends createZodDto(
  z.object({ amountKwh: z.number().positive().max(5000) }),
) {}
