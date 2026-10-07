import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AppRole } from "@prisma/client";
import type { Request } from "express";

import type { JwtPayload } from "../../auth/jwt-payload";
import { UsersService } from "../../users/users.service";
import { ALLOW_QUERY_TOKEN_KEY } from "../decorators/allow-query-token.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthUser } from "../types/auth-user";

/**
 * Global authentication guard (replaces requireSupabaseAuth).
 *
 * Verifies the JWT signature and expiry, then re-reads the user and their roles
 * from PostgreSQL so that deleted users, logged-out tokens (token_version) and
 * role changes take effect immediately. Roles are never taken from the token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const allowQuery = this.reflector.getAllAndOverride<boolean>(ALLOW_QUERY_TOKEN_KEY, targets);
    const token = extractToken(request, Boolean(allowQuery));
    if (!token) throw new UnauthorizedException("Unauthorized");

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Your session has expired. Please sign in again.");
    }

    const record = await this.users.findAuthRecord(payload.sub);
    if (!record || record.token_version !== payload.ver) {
      throw new UnauthorizedException("Your session has expired. Please sign in again.");
    }

    const roles = record.roles.map((r) => r.role);
    request.user = {
      id: record.id,
      email: record.email,
      roles,
      isAdmin: roles.includes(AppRole.admin),
    };
    return true;
  }
}

function extractToken(request: Request, allowQuery: boolean): string | null {
  const header = request.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim() || null;
  if (allowQuery) {
    const fromQuery = request.query["access_token"];
    if (typeof fromQuery === "string" && fromQuery) return fromQuery;
  }
  return null;
}
