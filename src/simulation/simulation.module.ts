import { Module } from "@nestjs/common";

import { AlertsModule } from "../alerts/alerts.module";
import { MeterEventsService } from "./meter-events.service";
import { MeterStreamController } from "./meter-stream.controller";
import { MeterTickerService } from "./meter-ticker.service";
import { SimulationController } from "./simulation.controller";
import { SimulationService } from "./simulation.service";

@Module({
  imports: [AlertsModule],
  controllers: [SimulationController, MeterStreamController],
  providers: [SimulationService, MeterEventsService, MeterTickerService],
  exports: [SimulationService, MeterEventsService],
})
export class SimulationModule {}
