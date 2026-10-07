import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.validation";

export interface ProviderConfig {
  username: string;
  apiKey: string;
  environment: string;
  senderId: string;
  serviceCode: string;
  webhookSecret: string;
  configured: boolean;
}

/**
 * Reads Africa's Talking settings (was readProviderConfig()). Switching between
 * sandbox and live is a configuration change, not a code change.
 */
@Injectable()
export class ProviderConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  read(): ProviderConfig {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    const username = get("AFRICASTALKING_USERNAME");
    const apiKey = get("AFRICASTALKING_API_KEY");
    return {
      username,
      apiKey,
      environment: get("AFRICASTALKING_ENVIRONMENT") || "sandbox",
      senderId: get("AFRICASTALKING_SMS_SENDER_ID") || get("AFRICASTALKING_SENDER_ID"),
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
      environment: cfg.environment,
      senderId: cfg.senderId,
      serviceCode: cfg.serviceCode,
    };
  }
}
