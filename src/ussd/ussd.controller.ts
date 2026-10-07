import { Controller, Get, Header, Logger, Post, Req, Res } from "@nestjs/common";
import { ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { Public } from "../common/decorators/public.decorator";
import { WebhookEventsService } from "../webhooks/webhook-events.service";
import { WebhookSecurityService } from "../webhooks/webhook-security.service";
import { UssdService } from "./ussd.service";

const PLAIN = "text/plain; charset=utf-8";

/**
 * Africa's Talking USSD callback.
 *
 * The provider POSTs sessionId, serviceCode, phoneNumber and the accumulated
 * text (application/x-www-form-urlencoded) and expects plain text starting
 * with "CON " (continue) or "END " (terminate).
 *
 * Served at /api/webhooks/ussd and, for existing channel configuration, at the
 * original /api/public/ussd.
 */
@ApiTags("webhooks")
@Public()
@SkipThrottle()
@Controller()
export class UssdController {
  private readonly logger = new Logger("UssdWebhook");

  constructor(
    private readonly ussd: UssdService,
    private readonly security: WebhookSecurityService,
    private readonly ledger: WebhookEventsService,
  ) {}

  @Post(["webhooks/ussd", "public/ussd"])
  @ApiConsumes("application/x-www-form-urlencoded")
  @ApiOperation({
    summary: "USSD session callback (Africa's Talking). Returns CON/END plain text.",
    description:
      "Optional hardening: HMAC-SHA256 of the raw body in x-africastalking-signature / x-webhook-signature, or ?token=<AFRICASTALKING_WEBHOOK_SECRET>. Replays of the same sessionId+text return the stored response.",
  })
  async callback(@Req() request: Request & { rawBody?: Buffer }, @Res() res: Response) {
    let eventRowId: string | null = null;
    try {
      const { payload, rawBody } = this.security.parse(request);
      const signature = this.security.verify(request, rawBody);
      if (!signature.allowed) {
        this.logger.warn(`rejected callback: ${signature.reason}`);
        return res.status(401).type(PLAIN).send("END Request could not be authenticated.");
      }

      const sessionId = payload["sessionId"] ?? "";
      const text = payload["text"] ?? "";

      const claim = await this.ledger.claim({
        provider: "africastalking",
        eventType: "ussd.request",
        externalId: `${sessionId}:${text}`,
        signatureVerified: signature.verified,
        payload: { ...payload, phoneNumber: payload["phoneNumber"] ?? "" },
      });
      if (claim.duplicate && claim.previousResponse) {
        return res.status(200).type(PLAIN).send(claim.previousResponse);
      }
      eventRowId = claim.eventRowId;

      const response = await this.ussd.handle({
        sessionId,
        serviceCode: payload["serviceCode"] ?? "",
        phoneNumber: payload["phoneNumber"] ?? "",
        text,
      });

      await this.ledger.complete(eventRowId, "PROCESSED", response);
      return res.status(200).type(PLAIN).send(response);
    } catch (error) {
      this.logger.error(
        `webhook failure: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.ledger.complete(eventRowId, "FAILED", null).catch(() => undefined);
      return res
        .status(200)
        .type(PLAIN)
        .send("END Service temporarily unavailable. Please try again later.");
    }
  }

  @Get(["webhooks/ussd", "public/ussd"])
  @ApiExcludeEndpoint()
  @Header("Content-Type", PLAIN)
  online() {
    return "USSD webhook is online. Configure this URL in your Africa's Talking USSD channel.";
  }
}
