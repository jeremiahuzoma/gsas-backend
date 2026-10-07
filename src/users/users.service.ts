import { Injectable } from "@nestjs/common";
import { AppRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  findAuthRecord(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, token_version: true, roles: { select: { role: true } } },
    });
  }

  async getRoles(userId: string): Promise<AppRole[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { user_id: userId },
      select: { role: true },
    });
    return rows.map((r) => r.role);
  }

  /** Equivalent of the original public.has_role(uid, 'admin'). */
  async isAdmin(userId: string): Promise<boolean> {
    const row = await this.prisma.userRole.findFirst({
      where: { user_id: userId, role: AppRole.admin },
      select: { id: true },
    });
    return Boolean(row);
  }

  async getProfile(userId: string) {
    return this.prisma.profile.findUnique({ where: { id: userId } });
  }
}
