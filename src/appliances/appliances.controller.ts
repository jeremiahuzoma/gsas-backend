import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { MeterAccessGuard } from "../meters/meter-access.guard";
import { AppliancesService } from "./appliances.service";
import { ConfigurationsService } from "./configurations.service";
import {
  AddApplianceDto,
  ReplaceAppliancesDto,
  SaveConfigurationDto,
  SetApplianceStateDto,
} from "./dto/appliances.dto";

@ApiTags("appliances")
@ApiBearerAuth()
@Controller("appliances")
export class ApplianceCatalogueController {
  constructor(private readonly appliances: AppliancesService) {}

  @Get()
  @ApiOperation({ summary: "Appliance catalogue, lowest rated power first (authenticated users)" })
  list() {
    return this.appliances.listCatalogue();
  }
}

@ApiTags("appliances")
@ApiBearerAuth()
@UseGuards(MeterAccessGuard)
@Controller("meters/:id")
export class MeterAppliancesController {
  constructor(
    private readonly appliances: AppliancesService,
    private readonly configurations: ConfigurationsService,
  ) {}

  @Post("appliances")
  @ApiOperation({ summary: "Connect an appliance to the meter (switched on)" })
  add(@Param("id") id: string, @Body() dto: AddApplianceDto) {
    return this.appliances.addToMeter(id, dto.applianceId);
  }

  @Put("appliances")
  @ApiOperation({ summary: "Replace / reorder the whole rig" })
  replace(@Param("id") id: string, @Body() dto: ReplaceAppliancesDto) {
    return this.appliances.replace(id, dto.items);
  }

  @Patch("appliances/:linkId")
  @ApiOperation({ summary: "Switch a connected appliance on or off" })
  setState(
    @Param("id") id: string,
    @Param("linkId", new ParseUUIDPipe()) linkId: string,
    @Body() dto: SetApplianceStateDto,
  ) {
    return this.appliances.setState(id, linkId, dto.isOn);
  }

  @Delete("appliances/:linkId")
  @ApiOperation({ summary: "Disconnect an appliance" })
  remove(@Param("id") id: string, @Param("linkId", new ParseUUIDPipe()) linkId: string) {
    return this.appliances.remove(id, linkId);
  }

  @Get("configurations")
  @ApiOperation({ summary: "Saved rigs for this meter" })
  listConfigurations(@Param("id") id: string) {
    return this.configurations.list(id);
  }

  @Post("configurations")
  @ApiOperation({ summary: "Save the current (or supplied) rig under a name" })
  saveConfiguration(@Param("id") id: string, @Body() dto: SaveConfigurationDto) {
    return this.configurations.save(id, dto);
  }

  @Post("configurations/:configId/apply")
  @ApiOperation({ summary: "Replace the live rig with a saved configuration" })
  applyConfiguration(
    @Param("id") id: string,
    @Param("configId", new ParseUUIDPipe()) configId: string,
  ) {
    return this.configurations.apply(id, configId);
  }

  @Post("configurations/:configId/default")
  @ApiOperation({ summary: "Mark a configuration as the default (replayed on reset)" })
  setDefault(@Param("id") id: string, @Param("configId", new ParseUUIDPipe()) configId: string) {
    return this.configurations.setDefault(id, configId);
  }

  @Delete("configurations/:configId")
  @ApiOperation({ summary: "Delete a saved configuration" })
  removeConfiguration(
    @Param("id") id: string,
    @Param("configId", new ParseUUIDPipe()) configId: string,
  ) {
    return this.configurations.remove(id, configId);
  }
}
