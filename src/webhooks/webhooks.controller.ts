import { Controller, Get, Header, Logger, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { Public } from "../common/decorators/public.decorator";
import { timingSafeEqual } from "../common/utils/timing-safe";
import { SmsRetryService } from "../communications/sms-retry.service";

import type { Env } from "../config/env.validation";
import { SmsDeliveryService } from "./sms-delivery.service";
import { WebhookEventsService } from "./webhook-events.service";
import { WebhookSecurityService } from "./webhook-security.service";

const PLAIN = "text/plain; charset=utf-8";

/**
 * Public provider callbacks. Each route is also served at its original
 * /api/public/* path so existing Africa's Talking configuration keeps working.
 */
@ApiTags("webhooks")
@Public()
@SkipThrottle()
@Controller()
export class WebhooksController {
  private readonly logger = new Logger("Webhooks");

  constructor(
    private readonly security: WebhookSecurityService,
    private readonly ledger: WebhookEventsService,
    private readonly delivery: SmsDeliveryService,
    private readonly retry: SmsRetryService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post(["webhooks/sms/delivery", "public/sms-delivery"])
  @ApiConsumes("application/x-www-form-urlencoded")
  @ApiOperation({
    summary: "SMS delivery report (Africa's Talking): id, status, phoneNumber, failureReason",
    description:
      "Signature-verified when AFRICASTALKING_WEBHOOK_SECRET is set. Idempotent on messageId:status; replays return the stored response. Returns 500 on processing errors so the provider retries.",
  })
  async smsDelivery(@Req() request: Request & { rawBody?: Buffer }, @Res() res: Response) {
    let eventRowId: string | null = null;
    try {
      const { payload, rawBody } = this.security.parse(request);
      const signature = this.security.verify(request, rawBody);
      if (!signature.allowed) {
        this.logger.warn(`rejected sms-delivery callback: ${signature.reason}`);
        return res.status(401).type(PLAIN).send("Invalid signature");
      }

      const messageId = payload["id"];
      const status = (payload["status"] ?? "").toLowerCase();
      if (!messageId) return res.status(400).type(PLAIN).send("missing id");

      const claim = await this.ledger.claim({
        provider: "africastalking",
        eventType: "sms.delivery",
        externalId: `${messageId}:${status}`,
        signatureVerified: signature.verified,
        payload,
      });
      if (claim.duplicate)
        return res
          .status(200)
          .type(PLAIN)
          .send(claim.previousResponse ?? "ok (duplicate)");
      eventRowId = claim.eventRowId;

      await this.delivery.apply(messageId, status, payload["failureReason"]);

      await this.ledger.complete(eventRowId, "PROCESSED", "ok");
      return res.status(200).type(PLAIN).send("ok");
    } catch (error) {
      this.logger.error(
        `sms-delivery failure: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.ledger.complete(eventRowId, "FAILED", "error").catch(() => undefined);
      // 500 asks the provider to retry; idempotency makes that safe.
      return res.status(500).type(PLAIN).send("error");
    }
  }

  @Get(["webhooks/sms/delivery", "public/sms-delivery"])
  @ApiExcludeEndpoint()
  @Header("Content-Type", PLAIN)
  smsDeliveryOnline() {
    return "SMS delivery webhook is online.";
  }

  /**
   * Retry worker trigger for schedulers (cron, uptime pinger...). Requires
   * SMS_RETRY_SECRET (or AFRICASTALKING_WEBHOOK_SECRET) as a Bearer token or ?token=.
   */
  @Post(["webhooks/sms/retry", "public/sms-retry"])
  @ApiOperation({ summary: "Run the SMS retry worker (shared secret required)" })
  async smsRetry(@Req() request: Request, @Res() res: Response) {
    const secret =
      this.config.get("SMS_RETRY_SECRET", { infer: true }) ||
      this.config.get("AFRICASTALKING_WEBHOOK_SECRET", { infer: true });
    if (!secret) return res.status(503).json({ error: "Retry worker is not configured" });

    const header = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const token = typeof request.query["token"] === "string" ? request.query["token"] : "";
    if (!timingSafeEqual(header, secret) && !timingSafeEqual(token, secret)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      return res.status(200).json(await this.retry.retryPending(25));
    } catch (error) {
      this.logger.error(
        `sms-retry worker failure: ${error instanceof Error ? error.message : String(error)}`,
      );
      return res.status(500).json({ error: "Retry run failed" });
    }
  }

  @Get(["webhooks/sms/retry", "public/sms-retry"])
  @ApiExcludeEndpoint()
  @Header("Content-Type", PLAIN)
  smsRetryOnline() {
    return "SMS retry worker is online. POST with the shared secret.";
  }
}
