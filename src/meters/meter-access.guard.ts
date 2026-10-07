import { BadRequestException, CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import type { AuthUser } from "../common/types/auth-user";
import { MeterAccessService } from "./meter-access.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards every `/meters/:id/...` route: the id must be a UUID (as the original
 * Zod validators required) and the caller must own the meter or be an admin.
 * Runs after the global JwtAuthGuard.
 */
@Injectable()
export class MeterAccessGuard implements CanActivate {
  constructor(private readonly access: MeterAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const param = request.params["id"];
    const meterId = typeof param === "string" ? param : undefined;
    if (!meterId || !UUID.test(meterId)) throw new BadRequestException("meterId: Invalid uuid");
    if (!request.user) return false;
    await this.access.assertAccess(request.user, meterId);
    return true;
  }
}
