import { Injectable } from "@nestjs/common";

import { simEvent, type SimEvent } from "../common/types/sim-event";
import { SmsService } from "../communications/sms.service";
import { TemplatesService } from "../communications/templates.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  estimatedRemainingSeconds,
  formatDuration,
  renderTemplate,
  round,
  type AlertKind,
} from "../simulation/energy";

const SEVERITY_FOR: Record<AlertKind, string> = {
  LOW_BALANCE: "LOW",
  CRITICAL_BALANCE: "CRITICAL",
  URGENT_BALANCE: "URGENT",
  METER_DEPLETED: "URGENT",
};

const FALLBACK_TEMPLATE =
  "ENERGY ALERT: Meter {{meterNumber}} has {{balance}} kWh remaining. Please recharge.";

export interface AlertMeter {
  id: string;
  user_id: string;
  meter_number: string;
  customer_name: string;
  phone_number: string | null;
  gsm: string;
}

/**
 * Alert engine (migrated from raiseAlert()): creates the alert row, renders the
 * SMS template and dispatches the SMS through the notification layer.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly sms: SmsService,
  ) {}

  async raiseAlert(
    meter: AlertMeter,
    kind: AlertKind,
    threshold: number,
    ctx: { totalPower: number; balance: number },
  ): Promise<SimEvent[]> {
    const events: SimEvent[] = [];
    const template = await this.templates.getBody(kind);

    const remaining = estimatedRemainingSeconds(ctx.balance, ctx.totalPower);
    const message = renderTemplate(template ?? FALLBACK_TEMPLATE, {
      customerName: meter.customer_name,
      meterNumber: meter.meter_number,
      balance: ctx.balance.toFixed(2),
      estimatedRemainingTime: formatDuration(remaining),
      currentLoad: (ctx.totalPower / 1000).toFixed(2),
    });

    const alert = await this.prisma.alert.create({
      data: {
        meter_id: meter.id,
        user_id: meter.user_id,
        type: kind,
        severity: SEVERITY_FOR[kind],
        threshold,
        balance_kwh: round(ctx.balance, 4),
        message,
        sms_status: "QUEUED",
      },
      select: { id: true },
    });

    events.push(
      simEvent(
        kind === "LOW_BALANCE" ? "warn" : "error",
        `${kind.replace("_", " ")} THRESHOLD REACHED at ${ctx.balance.toFixed(2)} kWh`,
      ),
    );

    const smsEvents = await this.sms.dispatch({
      meterId: meter.id,
      userId: meter.user_id,
      alertId: alert.id,
      phoneNumber: meter.phone_number,
      message,
      gsm: meter.gsm,
    });
    events.push(...smsEvents);
    return events;
  }
}
