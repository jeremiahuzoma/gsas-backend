import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.validation";

export interface ProviderConfig {
  username: string;
  apiKey: string;
  jsonUrl: string;
  senderId: string;
  serviceCode: string;
  webhookSecret: string;
  configured: boolean;
}

/**
 * EbulkSMS handles outbound SMS; Africa's Talking is used only for USSD.
 */
@Injectable()
export class ProviderConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  read(): ProviderConfig {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    const username = get("EBULKSMS_USERNAME");
    const apiKey = get("EBULKSMS_APIKEY");
    return {
      username,
      apiKey,
      jsonUrl: get("EBULKSMS_JSON_URL"),
      senderId: get("EBULKSMS_SENDER") || "GSAS",
      serviceCode: get("AFRICASTALKING_USSD_SERVICE_CODE") || get("AFRICASTALKING_SERVICE_CODE"),
      webhookSecret: get("AFRICASTALKING_WEBHOOK_SECRET"),
      configured: Boolean(username && apiKey),
    };
  }

  /** Only non-sensitive fields ever reach the browser (same as getCommsConfig). */
  publicView() {
    const cfg = this.read();
    return {
      configured: cfg.configured,
      provider: "EbulkSMS",
      senderId: cfg.senderId,
      serviceCode: cfg.serviceCode,
    };
  }
}
