import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

const FAILED_STATUSES = ["failed", "rejected", "invalidphonenumber", "userinblacklist"];

/**
 * Applies an Africa's Talking delivery report. Only a "Success"/"Delivered"
 * report marks an SMS as DELIVERED — an accepted API response alone only
 * means SENT.
 */
@Injectable()
export class SmsDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(messageId: string, rawStatus: string, failureReason?: string) {
    const status = rawStatus.toLowerCase();
    const delivered = status === "success" || status === "delivered";
    const failed = FAILED_STATUSES.includes(status);

    await this.prisma.smsLog.updateMany({
      where: { provider_message_id: messageId },
      data: {
        status: delivered ? "DELIVERED" : failed ? "FAILED" : "SENT",
        delivered_at: delivered ? new Date() : null,
        failure_reason: failed ? (failureReason ?? status) : null,
        // permanent rejections are never retried
        next_attempt_at: null,
      },
    });
  }
}
