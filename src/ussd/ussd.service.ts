import { Injectable } from "@nestjs/common";

import { num } from "../common/utils/serialize";
import { normalisePhone } from "../communications/phone";
import { TemplatesService } from "../communications/templates.service";
import { PrismaService } from "../prisma/prisma.service";
import { estimatedRemainingSeconds, formatDuration, round } from "../simulation/energy";
import type { UssdRequest, UssdResponse } from "./ussd.types";

export const USSD_MENU = [
  "1. Meter Balance",
  "2. Current Load",
  "3. Meter Status",
  "4. Today's Consumption",
  "5. Estimated Remaining Time",
  "6. Last Recharge",
  "7. Exit",
].join("\n");

/**
 * USSD menu (migrated from src/lib/ussd.server.ts).
 *
 * The provider is an unauthenticated external caller, so access is scoped by
 * the MSISDN it reports: a caller only ever sees meters registered to their
 * own phone number. Every leg is recorded in ussd_sessions; a provider retry
 * of the same (sessionId, text) leg is ignored.
 */
@Injectable()
export class UssdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
  ) {}

  async handle(req: UssdRequest): Promise<UssdResponse> {
    const phone = normalisePhone(req.phoneNumber) ?? req.phoneNumber;

    const meters = await this.prisma.meter.findMany({
      where: { phone_number: phone },
      orderBy: { created_at: "asc" },
    });

    const respond = async (body: string, meterId: string | null, userId: string | null) => {
      const ended = body.startsWith("END");
      // Idempotent: a provider retry of the same session leg is ignored.
      await this.prisma.ussdSession.createMany({
        data: [
          {
            session_id: req.sessionId || `local-${Date.now()}`,
            phone_number: phone,
            service_code: req.serviceCode,
            meter_id: meterId,
            user_id: userId,
            request_text: req.text,
            response_text: body,
            status: ended ? "COMPLETED" : "ACTIVE",
            ended_at: ended ? new Date() : null,
          },
        ],
        skipDuplicates: true,
      });
      return body;
    };

    const templateFor = async (key: string, fallback: string) =>
      (await this.templates.getBody(key))?.trim() || fallback;

    if (meters.length === 0) {
      return respond(
        `END ${await templateFor(
          "USSD_NOT_REGISTERED",
          "This phone number is not registered with the Energy Monitoring System.",
        )}`,
        null,
        null,
      );
    }

    const header = await templateFor("USSD_WELCOME", "PREPAID ENERGY MONITOR");
    const steps = req.text ? req.text.split("*").filter((s) => s !== "") : [];

    // With several meters, the first step selects the meter.
    let meter = meters[0]!;
    let menuSteps = steps;
    if (meters.length > 1) {
      if (steps.length === 0) {
        const list = meters.map((m, i) => `${i + 1}. Meter ${m.meter_number}`).join("\n");
        return respond(`CON ${header}\nSelect meter:\n${list}`, null, meters[0]!.user_id);
      }
      const index = Number(steps[0]) - 1;
      const selected = meters[index];
      if (!selected) return respond("END Invalid meter selection.", null, meters[0]!.user_id);
      meter = selected;
      menuSteps = steps.slice(1);
    }

    if (menuSteps.length === 0) {
      return respond(`CON ${header}\n\n${USSD_MENU}`, meter.id, meter.user_id);
    }

    // The latest answer is the choice. (The original read the first answer, so
    // after "Invalid option. Please choose again" every retry was rejected too.)
    const choice = menuSteps[menuSteps.length - 1];
    const balance = num(meter.balance_kwh);
    const power = num(meter.power_watts);

    switch (choice) {
      case "1":
        return respond(
          `END Meter ${meter.meter_number}\nBalance: ${balance.toFixed(2)} kWh\nLoad: ${(power / 1000).toFixed(2)} kW\nStatus: ${meter.status}`,
          meter.id,
          meter.user_id,
        );
      case "2":
        return respond(
          `END Meter ${meter.meter_number}\nLoad: ${(power / 1000).toFixed(2)} kW\nCurrent: ${num(meter.current_amps).toFixed(2)} A\nVoltage: ${num(meter.voltage).toFixed(1)} V`,
          meter.id,
          meter.user_id,
        );
      case "3":
        return respond(
          `END Meter ${meter.meter_number}\nStatus: ${meter.status}\nGSM: ${meter.gsm}\nSimulation: ${meter.simulation_running ? "RUNNING" : "PAUSED"}`,
          meter.id,
          meter.user_id,
        );
      case "4": {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const agg = await this.prisma.meterReading.aggregate({
          where: { meter_id: meter.id, recorded_at: { gte: since } },
          _sum: { energy_kwh: true },
        });
        const today = num(agg._sum.energy_kwh);
        const cost = today * num(meter.tariff_per_kwh);
        return respond(
          `END Meter ${meter.meter_number}\nToday: ${round(today, 3).toFixed(3)} kWh\nSimulated cost: NGN ${cost.toFixed(2)}`,
          meter.id,
          meter.user_id,
        );
      }
      case "5": {
        const remaining = estimatedRemainingSeconds(balance, power);
        return respond(
          `END Meter ${meter.meter_number}\nBalance: ${balance.toFixed(2)} kWh\nAt current load: ${remaining === null ? "no active load" : formatDuration(remaining)}`,
          meter.id,
          meter.user_id,
        );
      }
      case "6": {
        const recharge = await this.prisma.recharge.findFirst({
          where: { meter_id: meter.id },
          orderBy: { created_at: "desc" },
          select: { amount_kwh: true, new_balance: true, created_at: true, reference: true },
        });
        if (!recharge) {
          return respond(
            `END Meter ${meter.meter_number}\nNo recharge recorded yet.`,
            meter.id,
            meter.user_id,
          );
        }
        return respond(
          `END Last recharge\n${num(recharge.amount_kwh).toFixed(2)} kWh on ${recharge.created_at.toLocaleDateString("en-GB")}\nRef: ${recharge.reference}`,
          meter.id,
          meter.user_id,
        );
      }
      case "7":
        return respond(
          "END Thank you for using the Energy Monitoring System.",
          meter.id,
          meter.user_id,
        );
      default:
        return respond(
          `CON Invalid option. Please choose again:\n\n${USSD_MENU}`,
          meter.id,
          meter.user_id,
        );
    }
  }
}
