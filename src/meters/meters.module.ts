import { Module } from "@nestjs/common";

import { SimulationModule } from "../simulation/simulation.module";
import { MetersController } from "./meters.controller";
import { MetersService } from "./meters.service";

@Module({
  imports: [SimulationModule],
  controllers: [MetersController],
  providers: [MetersService],
})
export class MetersModule {}
