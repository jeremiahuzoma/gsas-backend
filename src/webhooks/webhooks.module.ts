import { Module } from "@nestjs/common";

import { SmsDeliveryService } from "./sms-delivery.service";
import { WebhookEventsService } from "./webhook-events.service";
import { WebhookSecurityService } from "./webhook-security.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
  controllers: [WebhooksController],
  providers: [WebhookSecurityService, WebhookEventsService, SmsDeliveryService],
  exports: [WebhookSecurityService, WebhookEventsService],
})
export class WebhooksModule {}
