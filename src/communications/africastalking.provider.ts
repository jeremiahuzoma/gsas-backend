import { Logger } from "@nestjs/common";

import { normalisePhone } from "./phone";
import type { ProviderConfig } from "./provider-config";
import type { SmsProvider, SmsResult } from "./sms-provider.interface";

/**
 * Africa's Talking SMS adapter (migrated from src/lib/africastalking.server.ts).
 * Credentials never leave the server and are never logged.
 */
export class AfricaTalkingSmsProvider implements SmsProvider {
  readonly name = "africastalking";
  private readonly logger = new Logger("AfricaTalkingSms");

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async sendSms(phoneNumber: string, message: string): Promise<SmsResult> {
    const to = normalisePhone(phoneNumber);
    if (!to) {
      return {
        status: "FAILED",
        failureReason: "Invalid phone number",
        retriable: false,
        simulated: false,
      };
    }

    // In-request retry for transient faults (network error, 429, 5xx).
    const attempts = 3;
    let last: SmsResult = {
      status: "FAILED",
      failureReason: "Not attempted",
      retriable: true,
      simulated: false,
    };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      last = await this.attemptSend(to, message);
      if (last.status === "SENT" || !last.retriable) return last;
      if (attempt < attempts) await this.sleep(400 * 2 ** (attempt - 1));
    }
    return last;
  }

  private baseUrl() {
    return this.config.environment === "production" || this.config.environment === "live"
      ? "https://api.africastalking.com"
      : "https://api.sandbox.africastalking.com";
  }

  private async attemptSend(to: string, message: string): Promise<SmsResult> {
    const body = new URLSearchParams({ username: this.config.username, to, message });
    if (this.config.senderId) body.set("from", this.config.senderId);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await this.fetchImpl(`${this.baseUrl()}/version1/messaging`, {
        method: "POST",
        headers: {
          apiKey: this.config.apiKey,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`provider responded ${res.status}`);
        return {
          status: "FAILED",
          failureReason: `Provider error ${res.status}: ${text.slice(0, 200)}`,
          retriable: res.status === 429 || res.status >= 500,
          simulated: false,
        };
      }

      const parsed = JSON.parse(text) as {
        SMSMessageData?: {
          Message?: string;
          Recipients?: Array<{
            statusCode?: number;
            status?: string;
            messageId?: string;
            cost?: string;
          }>;
        };
      };
      const recipient = parsed.SMSMessageData?.Recipients?.[0];
      if (!recipient) {
        return {
          status: "FAILED",
          failureReason: parsed.SMSMessageData?.Message ?? "No recipient accepted",
          retriable: false,
          simulated: false,
        };
      }
      const accepted = recipient.statusCode === 100 || recipient.statusCode === 101;
      // 405/406/407 = internal/gateway/rejection errors worth retrying.
      const transient = [405, 406, 407, 500, 501].includes(recipient.statusCode ?? 0);
      return {
        status: accepted ? "SENT" : "FAILED",
        providerMessageId: recipient.messageId,
        cost: recipient.cost,
        failureReason: accepted ? undefined : recipient.status,
        retriable: accepted ? false : transient,
        simulated: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown provider error";
      this.logger.error("provider request failed");
      return { status: "FAILED", failureReason: reason, retriable: true, simulated: false };
    }
  }
}

/**
 * Used only when provider credentials are absent, so the simulation remains
 * demonstrable. Clearly marked as simulated in the SMS log.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = "unconfigured";
  async sendSms(): Promise<SmsResult> {
    return {
      status: "FAILED",
      failureReason: "SMS provider not configured (missing Africa's Talking credentials)",
      retriable: false,
      simulated: true,
    };
  }
}
