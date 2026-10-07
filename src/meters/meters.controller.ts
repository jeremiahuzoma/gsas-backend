import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { SimulationService } from "../simulation/simulation.service";
import { UpdateMeterSettingsDto } from "./dto/meters.dto";
import { MeterAccessGuard } from "./meter-access.guard";
import { MetersService } from "./meters.service";

@ApiTags("meters")
@ApiBearerAuth()
@Controller("meters")
export class MetersController {
  constructor(
    private readonly meters: MetersService,
    private readonly simulation: SimulationService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Meters visible to the caller" })
  list(@CurrentUser() user: AuthUser) {
    return this.meters.list(user);
  }

  @Get("current")
  @ApiOperation({
    summary: "Snapshot of the caller's first meter (was getMeterState); null when there is none",
  })
  async current(@CurrentUser() user: AuthUser) {
    return { snapshot: await this.simulation.readCurrentSnapshot(user) };
  }

  @Get(":id")
  @UseGuards(MeterAccessGuard)
  @ApiOperation({ summary: "Snapshot of one meter (does not advance the simulation)" })
  get(@Param("id") id: string) {
    return this.simulation.readSnapshot(id);
  }

  @Patch(":id")
  @UseGuards(MeterAccessGuard)
  @ApiOperation({
    summary: "Update meter settings (phone, name, tariff, thresholds, GSM state, initial balance)",
  })
  update(@Param("id") id: string, @Body() dto: UpdateMeterSettingsDto) {
    return this.meters.updateSettings(id, dto);
  }
}
