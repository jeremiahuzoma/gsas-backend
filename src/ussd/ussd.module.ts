import { Module } from "@nestjs/common";

import { WebhooksModule } from "../webhooks/webhooks.module";
import { UssdController } from "./ussd.controller";
import { UssdService } from "./ussd.service";

@Module({
  imports: [WebhooksModule],
  controllers: [UssdController],
  providers: [UssdService],
  exports: [UssdService],
})
export class UssdModule {}
