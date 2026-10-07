import { Global, Module } from "@nestjs/common";

import { MeterAccessGuard } from "./meter-access.guard";
import { MeterAccessService } from "./meter-access.service";

@Global()
@Module({
  providers: [MeterAccessService, MeterAccessGuard],
  exports: [MeterAccessService, MeterAccessGuard],
})
export class MeterAccessModule {}
