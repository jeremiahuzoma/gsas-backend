import { Module } from "@nestjs/common";

import { AdminBootstrapController, AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminBootstrapController, AdminController],
  providers: [AdminService],
})
export class AdminModule {}
