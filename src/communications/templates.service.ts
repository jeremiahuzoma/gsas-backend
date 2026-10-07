import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

/** Reads notification_templates bodies (SMS and USSD text). */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBody(key: string): Promise<string | null> {
    const row = await this.prisma.notificationTemplate.findUnique({
      where: { key },
      select: { body: true },
    });
    return row?.body ?? null;
  }
}
