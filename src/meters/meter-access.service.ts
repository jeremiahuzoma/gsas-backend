import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Row-level authorization that Supabase RLS used to provide.
 *
 *  meters_owner_all            -> assertAccess(): owner or admin
 *  meter_appliances_owner,
 *  readings_owner,
 *  recharges_owner,
 *  meter_configurations_owner  -> child rows are only ever queried through a
 *                                 meter that passed assertAccess()
 *  alerts_owner, sms_logs_owner,
 *  ussd_owner                  -> ownedRowsWhere(): user_id = caller unless admin
 *
 * A meter the caller may not see is reported as "Meter not found", exactly as
 * RLS made it invisible before.
 */
@Injectable()
export class MeterAccessService {
  constructor(private readonly prisma: PrismaService) {}

  visibleMetersWhere(user: AuthUser): Prisma.MeterWhereInput {
    return user.isAdmin ? {} : { user_id: user.id };
  }

  ownedRowsWhere(user: AuthUser): { user_id?: string } {
    return user.isAdmin ? {} : { user_id: user.id };
  }

  async assertAccess(user: AuthUser, meterId: string) {
    const meter = await this.prisma.meter.findFirst({
      where: { id: meterId, ...this.visibleMetersWhere(user) },
    });
    if (!meter) throw new NotFoundException("Meter not found");
    return meter;
  }
}
