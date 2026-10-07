import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { SimulationService } from "../simulation/simulation.service";

/** Appliance catalogue and the live appliance rig attached to a meter. */
@Injectable()
export class AppliancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulation: SimulationService,
  ) {}

  listCatalogue() {
    return this.prisma.appliance.findMany({ orderBy: { rated_power: "asc" } });
  }

  async addToMeter(meterId: string, applianceId: string) {
    try {
      await this.prisma.meterAppliance.create({
        data: { meter_id: meterId, appliance_id: applianceId, is_on: true },
      });
    } catch (error) {
      if (isForeignKeyError(error)) {
        throw new BadRequestException("Could not add appliance to the simulation");
      }
      throw error;
    }
    return this.simulation.publishCurrent(meterId);
  }

  async setState(meterId: string, linkId: string, isOn: boolean) {
    await this.prisma.meterAppliance.updateMany({
      where: { id: linkId, meter_id: meterId },
      data: { is_on: isOn },
    });
    return this.simulation.publishCurrent(meterId);
  }

  async remove(meterId: string, linkId: string) {
    await this.prisma.meterAppliance.deleteMany({ where: { id: linkId, meter_id: meterId } });
    return this.simulation.publishCurrent(meterId);
  }

  /** Reorders / bulk-sets the live rig from the drag-and-drop canvas. */
  async replace(meterId: string, items: Array<{ applianceId: string; isOn: boolean }>) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.meterAppliance.deleteMany({ where: { meter_id: meterId } });
        await createLinksInOrder(tx, meterId, items);
      });
    } catch (error) {
      if (isForeignKeyError(error)) throw new BadRequestException("Unknown appliance in the rig");
      throw error;
    }
    return this.simulation.publishCurrent(meterId);
  }
}

/**
 * Inserts links one by one so created_at preserves the drag-and-drop order
 * (the rig is always listed by created_at).
 */
export async function createLinksInOrder(
  tx: Prisma.TransactionClient,
  meterId: string,
  items: Array<{ applianceId: string; isOn?: boolean }>,
) {
  const base = Date.now();
  for (const [index, item] of items.entries()) {
    await tx.meterAppliance.create({
      data: {
        meter_id: meterId,
        appliance_id: item.applianceId,
        is_on: item.isOn ?? true,
        created_at: new Date(base + index),
      },
    });
  }
}

export function isForeignKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}
