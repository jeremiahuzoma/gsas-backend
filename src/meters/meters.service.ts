import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthUser } from "../common/types/auth-user";
import { INVALID_PHONE_MESSAGE, normalisePhone } from "../communications/phone";
import { SmsService } from "../communications/sms.service";
import { PrismaService } from "../prisma/prisma.service";
import { MeterEventsService } from "../simulation/meter-events.service";
import { SimulationService } from "../simulation/simulation.service";
import { MeterAccessService } from "./meter-access.service";
import { signalFor, type UpdateMeterSettingsDto } from "./dto/meters.dto";

@Injectable()
export class MetersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeterAccessService,
    private readonly simulation: SimulationService,
    private readonly sms: SmsService,
    private readonly events: MeterEventsService,
  ) {}

  /** Meters visible to the caller (own meters; every meter for an admin). */
  list(user: AuthUser) {
    return this.prisma.meter.findMany({
      where: this.access.visibleMetersWhere(user),
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        meter_number: true,
        customer_name: true,
        phone_number: true,
        balance_kwh: true,
        status: true,
        gsm: true,
        simulation_running: true,
        created_at: true,
      },
    });
  }

  /** updateMeterSettings: customer-editable settings, GSM simulation and queued SMS flush. */
  async updateSettings(meterId: string, dto: UpdateMeterSettingsDto) {
    const update: Prisma.MeterUpdateInput = {};
    if (dto.phoneNumber) {
      const phone = normalisePhone(dto.phoneNumber);
      if (!phone) throw new BadRequestException(INVALID_PHONE_MESSAGE);
      update.phone_number = phone;
    }
    if (dto.customerName) update.customer_name = dto.customerName;
    if (dto.tariff !== undefined) update.tariff_per_kwh = dto.tariff;
    if (dto.low !== undefined) update.low_threshold = dto.low;
    if (dto.critical !== undefined) update.critical_threshold = dto.critical;
    if (dto.urgent !== undefined) update.urgent_threshold = dto.urgent;
    if (dto.initialBalance !== undefined) update.initial_balance = dto.initialBalance;
    if (dto.gsm) {
      update.gsm = dto.gsm;
      update.signal_dbm = signalFor(dto.gsm);
    }

    await this.prisma.meter.update({ where: { id: meterId }, data: update });

    if (dto.gsm === "CONNECTED") {
      // GSM reconnected: flush SMS held in the queue while it was down.
      const events = await this.sms.processQueued(meterId);
      this.events.publishEvents(meterId, events);
    }
    return this.simulation.publishCurrent(meterId);
  }
}
