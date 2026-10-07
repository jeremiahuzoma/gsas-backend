import { Injectable } from "@nestjs/common";

import type { AuthUser } from "../common/types/auth-user";
import { MeterAccessService } from "../meters/meter-access.service";
import { PrismaService } from "../prisma/prisma.service";

/** Alert centre, SMS log and USSD session history (was history.functions.ts). */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeterAccessService,
  ) {}

  alerts(user: AuthUser) {
    return this.prisma.alert.findMany({
      where: this.access.ownedRowsWhere(user),
      include: { meter: { select: { meter_number: true } } },
      orderBy: { created_at: "desc" },
      take: 200,
    });
  }

  smsLogs(user: AuthUser) {
    return this.prisma.smsLog.findMany({
      where: this.access.ownedRowsWhere(user),
      orderBy: { created_at: "desc" },
      take: 200,
    });
  }

  ussdSessions(user: AuthUser) {
    return this.prisma.ussdSession.findMany({
      where: this.access.ownedRowsWhere(user),
      orderBy: { started_at: "desc" },
      take: 200,
    });
  }
}
