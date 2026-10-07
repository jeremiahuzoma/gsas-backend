import { Module } from "@nestjs/common";

import { SimulationModule } from "../simulation/simulation.module";
import { RechargesController } from "./recharges.controller";
import { RechargesService } from "./recharges.service";

@Module({
  imports: [SimulationModule],
  controllers: [RechargesController],
  providers: [RechargesService],
})
export class RechargesModule {}
