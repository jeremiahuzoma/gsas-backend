import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ZodValidationPipe } from "nestjs-zod";

import { AdminModule } from "./admin/admin.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AppliancesModule } from "./appliances/appliances.module";
import { AuthModule } from "./auth/auth.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { JsonSafeInterceptor } from "./common/interceptors/json-safe.interceptor";
import { CommunicationsModule } from "./communications/communications.module";
import { validateEnv } from "./config/env.validation";
import { HealthController } from "./health.controller";
import { HistoryModule } from "./history/history.module";
import { MeterAccessModule } from "./meters/meter-access.module";
import { MetersModule } from "./meters/meters.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RechargesModule } from "./recharges/recharges.module";
import { SimulationModule } from "./simulation/simulation.module";
import { UsersModule } from "./users/users.module";
import { UssdModule } from "./ussd/ussd.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Generous default; auth and test-SMS routes set tighter limits.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    PrismaModule,
    UsersModule,
    AuthModule,
    MeterAccessModule,
    CommunicationsModule,
    SimulationModule,
    MetersModule,
    AppliancesModule,
    RechargesModule,
    AnalyticsModule,
    HistoryModule,
    WebhooksModule,
    UssdModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: JsonSafeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
