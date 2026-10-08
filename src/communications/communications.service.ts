import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthUser } from "../common/types/auth-user";
import { MeterAccessService } from "../meters/meter-access.service";
import { PrismaService } from "../prisma/prisma.service";
import type { TestSmsDto } from "./dto/test-sms.dto";
import { INVALID_PHONE_MESSAGE, normalisePhone } from "./phone";
import { ProviderConfigService } from "./provider-config";
import { SmsService } from "./sms.service";

const TEST_SMS_LIMIT = 5;
const TEST_SMS_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly providerConfig: ProviderConfigService,
    private readonly access: MeterAccessService,
  ) {}

  getPublicConfig() {
    return this.providerConfig.publicView();
  }

  /** Controlled real-SMS test with a per-user rate limit (5 per 5 minutes). */
  async sendTestSms(user: AuthUser, dto: TestSmsDto) {
    await this.access.assertAccess(user, dto.meterId);

    if (!this.providerConfig.read().configured) {
      throw new ServiceUnavailableException(
        "SMS provider is not configured. Add your EbulkSMS username and API key to the backend environment.",
      );
    }
    const phone = normalisePhone(dto.phoneNumber);
    if (!phone) throw new BadRequestException(INVALID_PHONE_MESSAGE);

    const since = new Date(Date.now() - TEST_SMS_WINDOW_MS);
    const count = await this.prisma.smsLog.count({
      where: { user_id: user.id, created_at: { gte: since } },
    });
    if (count >= TEST_SMS_LIMIT) {
      throw new HttpException(
        "Test SMS rate limit reached (5 per 5 minutes). Please wait a moment.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const message =
      dto.message ?? "TEST: Prepaid Energy Monitoring System is connected to the GSM/SMS network.";

    const log = await this.prisma.smsLog.create({
      data: {
        meter_id: dto.meterId,
        user_id: user.id,
        phone_number: phone,
        message,
        status: "QUEUED",
      },
      select: { id: true },
    });

    const result = await this.sms.sendAndRecord(log.id, phone, message);
    if (result.status !== "SENT") {
      throw new HttpException(
        result.failureReason ?? "The SMS provider rejected the message",
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { status: result.status, providerMessageId: result.providerMessageId ?? null };
  }
}
