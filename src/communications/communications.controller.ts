import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { CommunicationsService } from "./communications.service";
import { TestSmsDto } from "./dto/test-sms.dto";

@ApiTags("communications")
@ApiBearerAuth()
@Controller("communications")
export class CommunicationsController {
  constructor(private readonly comms: CommunicationsService) {}

  @Get("config")
  @ApiOperation({
    summary: "Non-sensitive SMS/USSD provider configuration (provider, sender id, service code)",
  })
  config() {
    return this.comms.getPublicConfig();
  }

  @Post("test-sms")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send a real test SMS (rate limited: 5 per 5 minutes per user)" })
  testSms(@CurrentUser() user: AuthUser, @Body() dto: TestSmsDto) {
    return this.comms.sendTestSms(user, dto);
  }
}
