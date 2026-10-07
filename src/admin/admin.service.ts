import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppRole, Prisma } from "@prisma/client";

import type { AuthUser } from "../common/types/auth-user";
import { INVALID_PHONE_MESSAGE, normalisePhone } from "../communications/phone";
import { SmsRetryService, type RetrySummary } from "../communications/sms-retry.service";
import { SmsService } from "../communications/sms.service";
import { signalFor } from "../meters/dto/meters.dto";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminUpdateMeterDto, SaveApplianceDto, SaveTemplateDto } from "./dto/admin.dto";

/** Advisory-lock key that serialises first-admin bootstrap attempts. */
const CLAIM_ADMIN_LOCK = 4_501_000_001;

/** Administrative console operations (was admin.functions.ts). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly retry: SmsRetryService,
  ) {}

  context(user: AuthUser) {
    return { isAdmin: user.isAdmin };
  }

  /**
   * First-run bootstrap: the first signed-in user may claim the administrator
   * role while no administrator exists (replaces public.claim_admin()).
   * Serialised with a transaction-scoped advisory lock so two simultaneous
   * claims cannot both succeed.
   */
  async claimAdmin(user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_ADMIN_LOCK}::bigint)`;
      const existing = await tx.userRole.findFirst({
        where: { role: AppRole.admin },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Administrator role has already been claimed");
      await tx.userRole.create({ data: { user_id: user.id, role: AppRole.admin } });
      return { granted: true };
    });
  }

  listMeters() {
    return this.prisma.meter.findMany({
      select: {
        id: true,
        meter_number: true,
        customer_name: true,
        phone_number: true,
        balance_kwh: true,
        total_consumed_kwh: true,
        status: true,
        gsm: true,
        tariff_per_kwh: true,
        low_threshold: true,
        critical_threshold: true,
        urgent_threshold: true,
        simulation_running: true,
        user_id: true,
        created_at: true,
      },
      orderBy: { created_at: "asc" },
    });
  }

  async updateMeter(meterId: string, dto: AdminUpdateMeterDto) {
    const update: Prisma.MeterUpdateInput = {};
    if (dto.customerName) update.customer_name = dto.customerName;
    if (dto.phoneNumber) {
      const phone = normalisePhone(dto.phoneNumber);
      if (!phone) throw new BadRequestException(INVALID_PHONE_MESSAGE);
      update.phone_number = phone;
    }
    if (dto.tariff !== undefined) update.tariff_per_kwh = dto.tariff;
    if (dto.low !== undefined) update.low_threshold = dto.low;
    if (dto.critical !== undefined) update.critical_threshold = dto.critical;
    if (dto.urgent !== undefined) update.urgent_threshold = dto.urgent;
    if (dto.status) update.status = dto.status;
    if (dto.gsm) {
      update.gsm = dto.gsm;
      update.signal_dbm = signalFor(dto.gsm);
    }
    const result = await this.prisma.meter.updateMany({ where: { id: meterId }, data: update });
    if (result.count === 0) throw new NotFoundException("Meter not found");
    return { ok: true };
  }

  listTemplates() {
    return this.prisma.notificationTemplate.findMany({
      select: { id: true, key: true, body: true, updated_at: true },
      orderBy: { key: "asc" },
    });
  }

  async saveTemplate(dto: SaveTemplateDto) {
    await this.prisma.notificationTemplate.upsert({
      where: { key: dto.key },
      update: { body: dto.body, updated_at: new Date() },
      create: { key: dto.key, body: dto.body },
    });
    return { ok: true };
  }

  async saveAppliance(dto: SaveApplianceDto, id?: string) {
    const row = {
      name: dto.name,
      category: dto.category,
      icon: dto.icon,
      rated_power: dto.ratedPower,
      idle_power: dto.idlePower,
      usage_profile: dto.usageProfile,
      duty_cycle: dto.dutyCycle,
      cycle_seconds: dto.cycleSeconds,
      power_factor: dto.powerFactor,
    };
    try {
      if (id) await this.prisma.appliance.update({ where: { id }, data: row });
      else await this.prisma.appliance.create({ data: row });
    } catch {
      throw new BadRequestException("Could not save this appliance");
    }
    return { ok: true };
  }

  async deleteAppliance(id: string) {
    try {
      await this.prisma.appliance.delete({ where: { id } });
    } catch {
      throw new BadRequestException("This appliance is in use and cannot be removed");
    }
    return { ok: true };
  }

  listSmsLogs(limit: number) {
    return this.prisma.smsLog.findMany({
      select: {
        id: true,
        phone_number: true,
        message: true,
        status: true,
        provider: true,
        provider_message_id: true,
        failure_reason: true,
        attempts: true,
        next_attempt_at: true,
        sent_at: true,
        delivered_at: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }

  listWebhookEvents() {
    return this.prisma.webhookEvent.findMany({
      select: {
        id: true,
        provider: true,
        event_type: true,
        external_id: true,
        signature_verified: true,
        status: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 50,
    });
  }

  /** Manually re-runs the SMS retry worker, or resends one log entry. */
  async retrySms(logId?: string): Promise<RetrySummary> {
    if (logId) {
      const log = await this.prisma.smsLog.findUnique({
        where: { id: logId },
        select: { id: true, phone_number: true, message: true, attempts: true },
      });
      if (!log) throw new NotFoundException("SMS log entry not found");
      const result = await this.sms.sendAndRecord(
        log.id,
        log.phone_number,
        log.message,
        log.attempts ?? 0,
      );
      const sent = result.status === "SENT" ? 1 : 0;
      return { scanned: 1, sent, failed: 1 - sent, exhausted: 0 };
    }
    return this.retry.retryPending(25);
  }
}
