import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { MeterAccessGuard } from "../meters/meter-access.guard";
import { AnalyticsService } from "./analytics.service";
import { OpsAnalyticsQueryDto, RangeQueryDto } from "./dto/analytics.dto";

@ApiTags("analytics")
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("analytics/ops")
  @ApiOperation({
    summary: "Consumption trend, threshold crossings, SMS/USSD delivery and retry pressure",
  })
  ops(@CurrentUser() user: AuthUser, @Query() query: OpsAnalyticsQueryDto) {
    return this.analytics.ops(user, query.days, query.meterId);
  }

  @Get("meters/:id/readings")
  @UseGuards(MeterAccessGuard)
  @ApiOperation({ summary: "Persisted meter readings in range (newest first, max 1000)" })
  readings(@Param("id") id: string, @Query() query: RangeQueryDto) {
    return this.analytics.readings(id, query.days);
  }

  @Get("meters/:id/analytics")
  @UseGuards(MeterAccessGuard)
  @ApiOperation({
    summary:
      "Total energy, average/peak load, average voltage, estimated cost, series, per-appliance and daily energy",
  })
  meterAnalytics(@Param("id") id: string, @Query() query: RangeQueryDto) {
    return this.analytics.meterAnalytics(id, query.days);
  }
}
