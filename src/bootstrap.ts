import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { cleanupOpenApiDoc } from "nestjs-zod";

import type { Env } from "./config/env.validation";

/**
 * HTTP hardening and documentation shared by main.ts and the e2e tests, so
 * tests exercise exactly the production pipeline.
 */
export function configureApp(app: INestApplication, opts: { swagger?: boolean } = {}) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix("api");
  app.use(
    helmet({
      // JSON/text API only; CSP is for HTML. Swagger UI needs inline scripts.
      contentSecurityPolicy: false,
    }),
  );

  const origins = config
    .get("FRONTEND_URL", { infer: true })
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  app.enableShutdownHooks();

  if (opts.swagger !== false) {
    const doc = new DocumentBuilder()
      .setTitle("Watts Up Meter API")
      .setDescription(
        [
          "Virtual prepaid energy meter simulation with EbulkSMS alerts and Africa's Talking USSD queries.",
          "",
          "Authenticate with POST /api/auth/login and send `Authorization: Bearer <accessToken>`.",
          "Live updates: GET /api/meters/{id}/events/stream (Server-Sent Events: meter.updated, simulation.event, error).",
          "All electrical values are SIMULATED.",
        ].join("\n"),
      )
      .setVersion("1.0.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup("api/docs", app, cleanupOpenApiDoc(document));
  }
}
