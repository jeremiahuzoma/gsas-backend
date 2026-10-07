import { Module } from "@nestjs/common";

import { SimulationModule } from "../simulation/simulation.module";
import { ApplianceCatalogueController, MeterAppliancesController } from "./appliances.controller";
import { AppliancesService } from "./appliances.service";
import { ConfigurationsService } from "./configurations.service";

@Module({
  imports: [SimulationModule],
  controllers: [ApplianceCatalogueController, MeterAppliancesController],
  providers: [AppliancesService, ConfigurationsService],
  exports: [AppliancesService],
})
export class AppliancesModule {}
