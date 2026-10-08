import { Global, Module } from "@nestjs/common";

import { EbulkSmsProvider, UnconfiguredSmsProvider } from "./ebulksms.provider";
import { CommunicationsController } from "./communications.controller";
import { CommunicationsService } from "./communications.service";
import { ProviderConfigService } from "./provider-config";
import { SMS_PROVIDER } from "./sms-provider.interface";
import { SmsRetryService } from "./sms-retry.service";
import { SmsService } from "./sms.service";
import { TemplatesService } from "./templates.service";

@Global()
@Module({
  controllers: [CommunicationsController],
  providers: [
    ProviderConfigService,
    {
      provide: SMS_PROVIDER,
      inject: [ProviderConfigService],
      useFactory: (cfg: ProviderConfigService) => {
        const config = cfg.read();
        return config.configured
          ? new EbulkSmsProvider(config)
          : new UnconfiguredSmsProvider();
      },
    },
    SmsService,
    SmsRetryService,
    TemplatesService,
    CommunicationsService,
  ],
  exports: [ProviderConfigService, SmsService, SmsRetryService, TemplatesService, SMS_PROVIDER],
})
export class CommunicationsModule {}
