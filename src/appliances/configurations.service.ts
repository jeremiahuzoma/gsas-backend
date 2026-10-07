import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { parseConfigItems, SimulationService } from "../simulation/simulation.service";
import { createLinksInOrder, isForeignKeyError } from "./appliances.service";

const CONFIG_FIELDS = {
  id: true,
  name: true,
  is_default: true,
  items: true,
  updated_at: true,
} as const;

/** Saved appliance rigs (drag-and-drop layouts). One per meter may be the default. */
@Injectable()
export class ConfigurationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulation: SimulationService,
  ) {}

  list(meterId: string) {
    return this.prisma.meterConfiguration.findMany({
      where: { meter_id: meterId },
      select: CONFIG_FIELDS,
      orderBy: { created_at: "asc" },
    });
  }

  /**
   * Saves the current (or supplied) rig under a name. Names are unique per
   * meter (case-insensitive), so saving over an existing name updates it.
   */
  async save(
    meterId: string,
    input: {
      name: string;
      makeDefault?: boolean;
      items?: Array<{ applianceId: string; isOn: boolean }>;
    },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        let items = input.items;
        if (!items) {
          const links = await tx.meterAppliance.findMany({
            where: { meter_id: meterId },
            select: { appliance_id: true, is_on: true },
            orderBy: { created_at: "asc" },
          });
          items = links.map((l) => ({ applianceId: l.appliance_id, isOn: l.is_on }));
        }

        if (input.makeDefault) {
          await tx.meterConfiguration.updateMany({
            where: { meter_id: meterId, is_default: true },
            data: { is_default: false },
          });
        }

        const existing = await tx.meterConfiguration.findFirst({
          where: { meter_id: meterId, name: { equals: input.name, mode: "insensitive" } },
          select: { id: true },
        });

        const payload = { name: input.name, is_default: input.makeDefault ?? false, items };
        return existing
          ? tx.meterConfiguration.update({
              where: { id: existing.id },
              data: payload,
              select: CONFIG_FIELDS,
            })
          : tx.meterConfiguration.create({
              data: { meter_id: meterId, ...payload },
              select: CONFIG_FIELDS,
            });
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException("Could not save this configuration");
    }
  }

  /** Replaces the live appliance rig with a saved configuration. */
  async apply(meterId: string, configurationId: string) {
    const config = await this.prisma.meterConfiguration.findFirst({
      where: { id: configurationId, meter_id: meterId },
      select: { items: true },
    });
    if (!config) throw new NotFoundException("Configuration not found");

    const items = parseConfigItems(config.items);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.meterAppliance.deleteMany({ where: { meter_id: meterId } });
        await createLinksInOrder(tx, meterId, items);
      });
    } catch (error) {
      if (isForeignKeyError(error)) {
        throw new BadRequestException(
          "This configuration references an appliance that no longer exists",
        );
      }
      throw error;
    }
    return this.simulation.publishCurrent(meterId);
  }

  async setDefault(meterId: string, configurationId: string) {
    await this.prisma.$transaction([
      this.prisma.meterConfiguration.updateMany({
        where: { meter_id: meterId, is_default: true },
        data: { is_default: false },
      }),
      this.prisma.meterConfiguration.updateMany({
        where: { id: configurationId, meter_id: meterId },
        data: { is_default: true },
      }),
    ]);
    return { ok: true };
  }

  async remove(meterId: string, configurationId: string) {
    await this.prisma.meterConfiguration.deleteMany({
      where: { id: configurationId, meter_id: meterId },
    });
    return { ok: true };
  }
}
