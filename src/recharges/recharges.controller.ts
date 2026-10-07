import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { MeterAccessGuard } from "../meters/meter-access.guard";
import { RechargeDto } from "./dto/recharge.dto";
import { RechargesService } from "./recharges.service";

@ApiTags("recharges")
@ApiBearerAuth()
@Controller()
export class RechargesController {
  constructor(private readonly recharges: RechargesService) {}

  @Post("meters/:id/recharge")
  @HttpCode(200)
  @UseGuards(MeterAccessGuard)
  @ApiOperation({ summary: "Recharge a meter (kWh); returns the new balance and snapshot" })
  recharge(@Param("id") id: string, @Body() dto: RechargeDto) {
    return this.recharges.recharge(id, dto.amountKwh);
  }

  @Get("recharges")
  @ApiOperation({ summary: "Recharge history for the caller's meters (latest 200)" })
  list(@CurrentUser() user: AuthUser) {
    return this.recharges.list(user);
  }
}
