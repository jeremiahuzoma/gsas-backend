import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_SMS_ATTEMPTS, SmsService } from "./sms.service";

export interface RetrySummary {
  scanned: number;
  sent: number;
  failed: number;
  exhausted: number;
}

/**
 * Background retry worker for SMS deliveries (migrated from
 * src/lib/sms-retry.server.ts).
 *
 * Any message whose scheduled retry time has arrived is re-sent using the same
 * provider adapter and attempt bookkeeping as the live simulation. Safe to run
 * concurrently: a row is claimed by atomically clearing next_attempt_at while it
 * is still due, so a parallel run cannot pick up the same message.
 *
 * Triggered by POST /api/webhooks/sms/retry (shared secret), by the admin
 * console, and — when SMS_RETRY_INTERVAL_MS > 0 — by an in-process timer.
 */
@Injectable()
export class SmsRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmsRetryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    const interval = this.config.get("SMS_RETRY_INTERVAL_MS", { infer: true });
    if (interval > 0) {
      this.timer = setInterval(() => void this.runScheduled(), interval);
      this.timer.unref();
      this.logger.log(`SMS retry worker running every ${interval} ms`);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runScheduled() {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.retryPending(25);
      if (summary.scanned > 0) this.logger.log(`retry run: ${JSON.stringify(summary)}`);
    } catch (error) {
      this.logger.error(
        `retry run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async retryPending(limit = 25): Promise<RetrySummary> {
    const now = new Date();
    const due = await this.prisma.smsLog.findMany({
      where: { status: "RETRY_SCHEDULED", next_attempt_at: { lte: now } },
      select: { id: true, phone_number: true, message: true, attempts: true },
      orderBy: { next_attempt_at: "asc" },
      take: limit,
    });

    const summary: RetrySummary = { scanned: due.length, sent: 0, failed: 0, exhausted: 0 };

    for (const row of due) {
      const attempts = row.attempts ?? 0;
      if (attempts >= MAX_SMS_ATTEMPTS) {
        await this.prisma.smsLog.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            next_attempt_at: null,
            failure_reason: "Retry budget exhausted",
          },
        });
        summary.exhausted += 1;
        continue;
      }

      // Claim the row so a parallel worker skips it.
      const claimed = await this.prisma.smsLog.updateMany({
        where: { id: row.id, status: "RETRY_SCHEDULED", next_attempt_at: { lte: now } },
        data: { next_attempt_at: null },
      });
      if (claimed.count === 0) continue;

      const result = await this.sms.sendAndRecord(row.id, row.phone_number, row.message, attempts);
      if (result.status === "SENT") summary.sent += 1;
      else summary.failed += 1;
    }

    return summary;
  }
}
