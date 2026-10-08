import { Inject, Injectable } from "@nestjs/common";

import { simEvent, type SimEvent } from "../common/types/sim-event";
import { PrismaService } from "../prisma/prisma.service";
import { SMS_PROVIDER, type SmsProvider, type SmsResult } from "./sms-provider.interface";

/** Backoff schedule (minutes) applied to retriable SMS failures. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 180];
export const MAX_SMS_ATTEMPTS = RETRY_BACKOFF_MINUTES.length;

export interface DispatchSmsInput {
  meterId: string | null;
  userId: string | null;
  alertId?: string | null;
  phoneNumber: string | null;
  message: string;
  gsm: string;
}

/**
 * SMS dispatch, attempt bookkeeping and queue processing.
 * Migrated from dispatchSms / sendAndRecord / processQueuedSms in
 * src/lib/simulation.server.ts with identical status transitions:
 *
 *   QUEUED -> SENDING -> SENT | RETRY_SCHEDULED | FAILED   (DELIVERED via webhook)
 */
@Injectable()
export class SmsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {}

  /**
   * Sends an SMS through the configured provider. When the meter's simulated GSM
   * module is disconnected the message is queued instead of being lost; it is
   * retried by processQueued() once the module reconnects.
   */
  async dispatch(input: DispatchSmsInput): Promise<SimEvent[]> {
    const events: SimEvent[] = [];
    if (!input.phoneNumber) {
      events.push(simEvent("error", "SMS skipped - no phone number configured on this meter"));
      return events;
    }

    const log = await this.prisma.smsLog.create({
      data: {
        meter_id: input.meterId,
        user_id: input.userId,
        alert_id: input.alertId ?? null,
        phone_number: input.phoneNumber,
        message: input.message,
        status: "QUEUED",
      },
      select: { id: true },
    });
    events.push(simEvent("info", "SMS QUEUED"));

    if (input.gsm === "DISCONNECTED") {
      events.push(simEvent("warn", "GSM module disconnected - SMS held in queue"));
      return events;
    }

    const result = await this.sendAndRecord(log.id, input.phoneNumber, input.message);
    events.push(
      simEvent(
        result.status === "SENT" ? "success" : "error",
        result.status === "SENT"
          ? "SMS SENT via EbulkSMS"
          : `SMS FAILED: ${result.failureReason ?? "unknown error"}`,
      ),
    );
    if (input.alertId) {
      await this.prisma.alert.update({
        where: { id: input.alertId },
        data: { sms_status: result.status },
      });
    }
    return events;
  }

  /** Sends once through the provider and records the attempt on the log row. */
  async sendAndRecord(
    logId: string | null,
    phoneNumber: string,
    message: string,
    attemptsSoFar = 0,
  ): Promise<SmsResult> {
    const attempt = attemptsSoFar + 1;
    if (logId) {
      await this.prisma.smsLog.update({
        where: { id: logId },
        data: { status: "SENDING", attempts: attempt, last_attempt_at: new Date() },
      });
    }

    const result = await this.provider.sendSms(phoneNumber, message);

    const shouldRetry =
      result.status !== "SENT" && Boolean(result.retriable) && attempt < MAX_SMS_ATTEMPTS;
    const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(attempt, MAX_SMS_ATTEMPTS) - 1] ?? 60;
    const nextAttemptAt = shouldRetry ? new Date(Date.now() + backoffMinutes * 60_000) : null;

    if (logId) {
      await this.prisma.smsLog.update({
        where: { id: logId },
        data: {
          status: result.status === "SENT" ? "SENT" : shouldRetry ? "RETRY_SCHEDULED" : "FAILED",
          provider: this.provider.name,
          provider_message_id: result.providerMessageId ?? null,
          cost: result.cost ?? null,
          failure_reason: result.failureReason ?? null,
          sent_at: result.status === "SENT" ? new Date() : null,
          next_attempt_at: nextAttemptAt,
        },
      });
    }
    return result;
  }

  /**
   * Retries messages queued while the GSM module was disconnected, plus any
   * message whose scheduled retry time has arrived.
   */
  async processQueued(meterId: string): Promise<SimEvent[]> {
    const pending = await this.prisma.smsLog.findMany({
      where: { meter_id: meterId, status: { in: ["QUEUED", "RETRY_SCHEDULED"] } },
      select: {
        id: true,
        phone_number: true,
        message: true,
        attempts: true,
        status: true,
        next_attempt_at: true,
      },
      orderBy: { created_at: "asc" },
    });
    const events: SimEvent[] = [];
    const now = Date.now();
    for (const row of pending) {
      if (
        row.status === "RETRY_SCHEDULED" &&
        row.next_attempt_at &&
        row.next_attempt_at.getTime() > now
      ) {
        continue;
      }
      const result = await this.sendAndRecord(
        row.id,
        row.phone_number,
        row.message,
        row.attempts ?? 0,
      );
      events.push(
        simEvent(
          result.status === "SENT" ? "success" : "error",
          result.status === "SENT"
            ? "Queued SMS delivered after retry"
            : `Queued SMS failed: ${result.failureReason ?? "unknown"}`,
        ),
      );
    }
    return events;
  }

  get providerName() {
    return this.provider.name;
  }
}
