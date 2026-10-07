import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { HistoryService } from "./history.service";

@ApiTags("history")
@ApiBearerAuth()
@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get("alerts")
  @ApiOperation({ summary: "Alert centre: latest 200 alerts for the caller's meters" })
  alerts(@CurrentUser() user: AuthUser) {
    return this.history.alerts(user);
  }

  @Get("sms-logs")
  @ApiOperation({ summary: "Latest 200 SMS log entries for the caller" })
  smsLogs(@CurrentUser() user: AuthUser) {
    return this.history.smsLogs(user);
  }

  @Get("ussd-sessions")
  @ApiOperation({ summary: "Latest 200 USSD session legs for the caller" })
  ussdSessions(@CurrentUser() user: AuthUser) {
    return this.history.ussdSessions(user);
  }
}
