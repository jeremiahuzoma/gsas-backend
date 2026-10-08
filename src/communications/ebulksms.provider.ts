import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { normalisePhone } from "./phone";
import type { ProviderConfig } from "./provider-config";
import type { SmsProvider, SmsResult } from "./sms-provider.interface";

/** EbulkSMS JSON API adapter. Credentials are sent only to the provider endpoint. */
export class EbulkSmsProvider implements SmsProvider {
  readonly name = "ebulksms";
  private readonly logger = new Logger("EbulkSms");

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

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await this.attemptSend(to, message);
      if (result.status === "SENT" || !result.retriable || attempt === 3) return result;
      await this.sleep(400 * 2 ** (attempt - 1));
    }

    return {
      status: "FAILED",
      failureReason: "EbulkSMS request failed",
      retriable: true,
      simulated: false,
    };
  }

  private async attemptSend(to: string, message: string): Promise<SmsResult> {
    const body = {
      SMS: {
        auth: {
          username: this.config.username,
          apikey: this.config.apiKey,
        },
        message: {
          sender: this.config.senderId,
          messagetext: message,
          flash: "0",
        },
        recipients: {
          gsm: [{ msidn: to.replace(/^\+/, ""), msgid: randomUUID() }],
        },
      },
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await this.fetchImpl(this.config.jsonUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`provider responded ${res.status}`);
        return {
          status: "FAILED",
          failureReason: `EbulkSMS error ${res.status}: ${text.slice(0, 200)}`,
          retriable: res.status === 429 || res.status >= 500,
          simulated: false,
        };
      }

      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        return {
          status: "FAILED",
          failureReason: "EbulkSMS returned an invalid response",
          retriable: false,
          simulated: false,
        };
      }
      const responseDetails = parsed["response"];
      const details = isRecord(responseDetails) ? responseDetails : parsed;
      const providerStatus = stringValue(details["status"]).toUpperCase();
      const failedCount = Number(details["failed"] ?? 0);
      const successfulCount = details["success"] == null ? null : Number(details["success"]);
      if (
        !["OK", "SUCCESS", "200"].includes(providerStatus) ||
        failedCount > 0 ||
        successfulCount === 0
      ) {
        return {
          status: "FAILED",
          failureReason:
            stringValue(details["message"]) ||
            stringValue(details["error"]) ||
            `EbulkSMS rejected the message (${providerStatus || "unknown response"})`,
          retriable: false,
          simulated: false,
        };
      }

      return {
        status: "SENT",
        providerMessageId:
          stringValue(details["smsid"]) ||
          stringValue(details["messageid"]) ||
          stringValue(details["id"]) ||
          undefined,
        cost: stringValue(details["cost"]) || undefined,
        retriable: false,
        simulated: false,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      this.logger.error(timedOut ? "provider request timed out" : "provider request failed");
      return {
        status: "FAILED",
        failureReason: timedOut ? "EbulkSMS request timed out" : "EbulkSMS request failed",
        retriable: true,
        simulated: false,
      };
    }
  }
}

/** Used when credentials are absent so local simulation remains available. */
export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = "unconfigured";

  async sendSms(): Promise<SmsResult> {
    return {
      status: "FAILED",
      failureReason: "SMS provider not configured (missing EbulkSMS credentials)",
      retriable: false,
      simulated: true,
    };
  }
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
