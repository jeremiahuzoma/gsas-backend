import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AppRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { AdminService } from "./admin.service";
import {
  AdminUpdateMeterDto,
  RetrySmsDto,
  SaveApplianceDto,
  SaveTemplateDto,
  SmsLogsQueryDto,
} from "./dto/admin.dto";

/** Signed-in users: admin status and first-admin bootstrap. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
export class AdminBootstrapController {
  constructor(private readonly admin: AdminService) {}

  @Get("context")
  @ApiOperation({ summary: "Whether the caller is an administrator" })
  context(@CurrentUser() user: AuthUser) {
    return this.admin.context(user);
  }

  @Post("claim")
  @HttpCode(200)
  @ApiOperation({ summary: "Claim the administrator role while no administrator exists" })
  claim(@CurrentUser() user: AuthUser) {
    return this.admin.claimAdmin(user);
  }
}

/** Administrator console. Every route requires the admin role, read from the database. */
@ApiTags("admin")
@ApiBearerAuth()
@Roles(AppRole.admin)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("meters")
  @ApiOperation({ summary: "All meters and customers" })
  meters() {
    return this.admin.listMeters();
  }

  @Patch("meters/:id")
  @ApiOperation({ summary: "Update customer, phone, tariff, thresholds, status or GSM state" })
  updateMeter(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: AdminUpdateMeterDto) {
    return this.admin.updateMeter(id, dto);
  }

  @Get("templates")
  @ApiOperation({ summary: "Notification templates (SMS and USSD text)" })
  templates() {
    return this.admin.listTemplates();
  }

  @Put("templates")
  @ApiOperation({ summary: "Create or update a template by key" })
  saveTemplate(@Body() dto: SaveTemplateDto) {
    return this.admin.saveTemplate(dto);
  }

  @Post("appliances")
  @ApiOperation({ summary: "Add an appliance to the catalogue" })
  createAppliance(@Body() dto: SaveApplianceDto) {
    return this.admin.saveAppliance(dto);
  }

  @Patch("appliances/:id")
  @ApiOperation({ summary: "Edit a catalogue appliance" })
  updateAppliance(@Param("id", new ParseUUIDPipe()) id: string, @Body() dto: SaveApplianceDto) {
    return this.admin.saveAppliance(dto, id);
  }

  @Delete("appliances/:id")
  @ApiOperation({ summary: "Remove a catalogue appliance" })
  deleteAppliance(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.admin.deleteAppliance(id);
  }

  @Get("sms-logs")
  @ApiOperation({ summary: "SMS delivery log across all meters" })
  smsLogs(@Query() query: SmsLogsQueryDto) {
    return this.admin.listSmsLogs(query.limit);
  }

  @Get("webhook-events")
  @ApiOperation({ summary: "Latest 50 inbound webhook events" })
  webhookEvents() {
    return this.admin.listWebhookEvents();
  }

  @Post("sms/retry")
  @HttpCode(200)
  @ApiOperation({ summary: "Run the SMS retry worker, or resend one log entry" })
  retrySms(@Body() dto: RetrySmsDto) {
    return this.admin.retrySms(dto.logId);
  }
}
