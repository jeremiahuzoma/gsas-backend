import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface IdempotencyOutcome {
  duplicate: boolean;
  /** response returned by the first successful processing of this event */
  previousResponse: string | null;
  eventRowId: string | null;
}

/**
 * Idempotency ledger for inbound callbacks. Every callback is recorded in
 * webhook_events under a unique (provider, event_type, external_id) key; a
 * replay short-circuits and returns the original response instead of
 * re-applying side effects.
 */
@Injectable()
export class WebhookEventsService {
  private readonly logger = new Logger(WebhookEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async claim(input: {
    provider: string;
    eventType: string;
    externalId: string;
    signatureVerified: boolean;
    payload: Record<string, string>;
  }): Promise<IdempotencyOutcome> {
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: input.provider,
          event_type: input.eventType,
          external_id: input.externalId,
          signature_verified: input.signatureVerified,
          payload: input.payload,
          status: "RECEIVED",
        },
        select: { id: true },
      });
      return { duplicate: false, previousResponse: null, eventRowId: row.id };
    } catch (error) {
      const existing = await this.prisma.webhookEvent.findUnique({
        where: {
          provider_event_type_external_id: {
            provider: input.provider,
            event_type: input.eventType,
            external_id: input.externalId,
          },
        },
        select: { id: true, response_text: true },
      });
      if (existing) {
        return {
          duplicate: true,
          previousResponse: existing.response_text,
          eventRowId: existing.id,
        };
      }
      // Insert failed for another reason - process anyway rather than dropping it.
      this.logger.error(
        `could not claim event: ${error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "unknown"}`,
      );
      return { duplicate: false, previousResponse: null, eventRowId: null };
    }
  }

  async complete(
    eventRowId: string | null,
    status: "PROCESSED" | "FAILED",
    responseText: string | null,
  ) {
    if (!eventRowId) return;
    await this.prisma.webhookEvent.update({
      where: { id: eventRowId },
      data: { status, response_text: responseText },
    });
  }
}
