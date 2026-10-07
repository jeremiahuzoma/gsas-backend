import { Injectable, NotFoundException } from "@nestjs/common";

import type { AuthUser } from "../common/types/auth-user";
import { num } from "../common/utils/serialize";
import { SmsService } from "../communications/sms.service";
import { TemplatesService } from "../communications/templates.service";
import { MeterAccessService } from "../meters/meter-access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  estimatedRemainingSeconds,
  formatDuration,
  renderTemplate,
  resetFlagsForBalance,
  round,
  statusForBalance,
} from "../simulation/energy";
import { MeterEventsService } from "../simulation/meter-events.service";
import { thresholdsOf } from "../simulation/simulation.engine";
import { lockMeter, SimulationService } from "../simulation/simulation.service";

@Injectable()
export class RechargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeterAccessService,
    private readonly simulation: SimulationService,
    private readonly templates: TemplatesService,
    private readonly sms: SmsService,
    private readonly events: MeterEventsService,
  ) {}

  /**
   * Applies a recharge and resets threshold flags so alerts can fire again
   * (migrated from applyRecharge()). The balance update and the recharge
   * record are written in one transaction holding the meter row lock; the
   * RECHARGE_SUCCESS SMS is sent after the commit.
   */
  async recharge(meterId: string, amountKwh: number) {
    const { meter, previous, next, reference } = await this.prisma.$transaction(async (tx) => {
      if (!(await lockMeter(tx, meterId))) throw new NotFoundException("Meter not found");
      const meter = await tx.meter.findUniqueOrThrow({ where: { id: meterId } });
      const previous = num(meter.balance_kwh);
      const next = round(previous + amountKwh, 4);
      const thresholds = thresholdsOf(meter);
      const flags = resetFlagsForBalance(next, thresholds);
      const reference = `RCH-${Date.now().toString(36).toUpperCase()}`;

      await tx.meter.update({
        where: { id: meterId },
        data: {
          balance_kwh: next,
          status: statusForBalance(next, thresholds),
          notified_low: flags.notifiedLow,
          notified_critical: flags.notifiedCritical,
          notified_urgent: flags.notifiedUrgent,
          notified_depleted: flags.notifiedDepleted,
        },
      });
      await tx.recharge.create({
        data: {
          meter_id: meterId,
          amount_kwh: amountKwh,
          previous_balance: previous,
          new_balance: next,
          reference,
        },
      });
      return { meter, previous, next, reference };
    });

    const template = await this.templates.getBody("RECHARGE_SUCCESS");
    if (template) {
      const power = num(meter.power_watts);
      const events = await this.sms.dispatch({
        meterId,
        userId: meter.user_id,
        phoneNumber: meter.phone_number,
        gsm: meter.gsm,
        message: renderTemplate(template, {
          customerName: meter.customer_name,
          meterNumber: meter.meter_number,
          balance: next.toFixed(2),
          currentLoad: (power / 1000).toFixed(2),
          estimatedRemainingTime: formatDuration(estimatedRemainingSeconds(next, power)),
        }),
      });
      this.events.publishEvents(meterId, events);
    }

    const snapshot = await this.simulation.publishCurrent(meterId);
    return { previous, next, reference, snapshot };
  }

  /** Recharge history for the caller's meters (was getRecharges). */
  list(user: AuthUser) {
    return this.prisma.recharge.findMany({
      where: { meter: this.access.visibleMetersWhere(user) },
      include: { meter: { select: { meter_number: true } } },
      orderBy: { created_at: "desc" },
      take: 200,
    });
  }
}
