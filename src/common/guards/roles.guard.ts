import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppRole } from "@prisma/client";
import type { Request } from "express";

import { ROLES_KEY } from "../decorators/roles.decorator";
import type { AuthUser } from "../types/auth-user";

/** Enforces @Roles(...) using the roles JwtAuthGuard loaded from the database. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (user && required.some((role) => user.roles.includes(role))) return true;

    throw new ForbiddenException(
      required.includes(AppRole.admin)
        ? "Administrator access is required for this action"
        : "You do not have access to this action",
    );
  }
}
