import { Body, Controller, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { MeterAccessGuard } from "../meters/meter-access.guard";
import { ForceThresholdDto, SimulationSpeedDto, StartSimulationDto } from "./dto/simulation.dto";
import { SimulationService } from "./simulation.service";

@ApiTags("simulation")
@ApiBearerAuth()
@UseGuards(MeterAccessGuard)
@Controller("meters/:id/simulation")
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Post("start")
  @HttpCode(200)
  @ApiOperation({ summary: "Start (or resume) the simulation, optionally at a new speed" })
  start(@Param("id") id: string, @Body() dto: StartSimulationDto) {
    return this.simulation.start(id, dto.speed);
  }

  @Post("pause")
  @HttpCode(200)
  @ApiOperation({ summary: "Pause the simulation" })
  pause(@Param("id") id: string) {
    return this.simulation.pause(id);
  }

  @Post("reset")
  @HttpCode(200)
  @ApiOperation({
    summary: "Reset balance to the initial balance, clear readings and replay the default rig",
  })
  reset(@Param("id") id: string) {
    return this.simulation.reset(id);
  }

  @Patch("speed")
  @ApiOperation({ summary: "Change the simulation speed (1–600×)" })
  speed(@Param("id") id: string, @Body() dto: SimulationSpeedDto) {
    return this.simulation.setSpeed(id, dto.speed);
  }

  @Post("demo")
  @HttpCode(200)
  @ApiOperation({ summary: "Presentation mode: 20 kWh balance, 300× speed, running" })
  demo(@Param("id") id: string) {
    return this.simulation.startDemo(id);
  }

  @Post("force-threshold")
  @HttpCode(200)
  @ApiOperation({
    summary: "Force the balance to a value and run one tick through the real alert engine",
  })
  forceThreshold(@Param("id") id: string, @Body() dto: ForceThresholdDto) {
    return this.simulation.forceThreshold(id, dto.balance);
  }
}
