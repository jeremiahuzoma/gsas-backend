import { createZodDto } from "nestjs-zod";
import { z } from "zod";

import { queryInt } from "../../common/utils/zod";

/** days: 1..365 (default 1), as in the original rangeSchema. */
export class RangeQueryDto extends createZodDto(z.object({ days: queryInt(1, 365, 1) })) {}

export class OpsAnalyticsQueryDto extends createZodDto(
  z.object({ days: queryInt(1, 365, 1), meterId: z.string().uuid().optional() }),
) {}
